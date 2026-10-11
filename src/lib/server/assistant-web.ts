import { lookup } from 'node:dns/promises';
import { get } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { deflateSync, inflateSync } from 'node:zlib';
import { z } from 'zod';

const blocked = new BlockList();
for (const [address, prefix] of [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.0.2.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['198.51.100.0', 24],
	['203.0.113.0', 24],
	['224.0.0.0', 4],
	['240.0.0.0', 4]
] as const)
	blocked.addSubnet(address, prefix, 'ipv4');
blocked.addSubnet('2001:db8::', 32, 'ipv6');
const globalIPv6 = new BlockList();
globalIPv6.addSubnet('2000::', 3, 'ipv6');
export function publicWebAddress(address: string) {
	const family = isIP(address);
	return family === 4
		? !blocked.check(address, 'ipv4')
		: family === 6 && globalIPv6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}
export function publicWebUrl(value: string) {
	const url = new URL(value);
	if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443'))
		throw new Error('Use a public HTTPS URL without credentials');
	return url;
}
export async function fetchPublicWeb(value: string, redirects = 0): Promise<string> {
	const url = publicWebUrl(value);
	const addresses = await lookup(url.hostname, { all: true });
	if (!addresses.length || addresses.some((item) => !publicWebAddress(item.address)))
		throw new Error('Private network addresses are not available to the assistant');
	const address = addresses[0];
	if (!address) throw new Error('Web host has no public address');
	const result = await new Promise<{ text: string; location?: string }>((resolve, reject) => {
		// Pin the checked address so a DNS change cannot redirect a fetch into the local network.
		const request = get(
			url,
			{
				family: address.family,
				lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
				headers: {
					'User-Agent': 'Facmandu/1.0 (blueprint research)',
					Accept: 'text/html,application/json,text/plain,application/rss+xml',
					'Accept-Encoding': 'identity'
				},
				signal: AbortSignal.timeout(15000)
			},
			(response) => {
				if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
					response.destroy();
					resolve({ text: '', location: response.headers.location });
					return;
				}
				if (response.statusCode !== 200) {
					response.destroy();
					reject(new Error(`Web source returned HTTP ${response.statusCode}`));
					return;
				}
				const type = response.headers['content-type'] ?? '';
				if (!/text\/|application\/(?:json|rss\+xml|xml)/i.test(type)) {
					response.destroy();
					reject(new Error('This source is not a text page'));
					return;
				}
				const chunks: Buffer[] = [];
				let size = 0;
				response.on('data', (chunk: Buffer) => {
					size += chunk.length;
					if (size > 1024 * 1024) {
						response.destroy(new Error('Web source exceeds 1 MiB'));
						return;
					}
					chunks.push(chunk);
				});
				response.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8') }));
				response.on('error', reject);
			}
		);
		request.on('error', reject);
	});
	if (result.location) {
		if (redirects >= 3) throw new Error('Too many web redirects');
		return fetchPublicWeb(new URL(result.location, url).href, redirects + 1);
	}
	return result.text;
}
const decode = (text: string) =>
	text.replace(
		/&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi,
		(_match, numeric: string | undefined, named: string | undefined) =>
			numeric
				? String.fromCodePoint(
						Math.min(
							0x10ffff,
							Number.parseInt(numeric.replace(/^x/i, ''), /^x/i.test(numeric) ? 16 : 10)
						)
					)
				: ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[named?.toLowerCase() ?? ''] ?? '')
	);
export function webPageText(html: string) {
	return decode(
		html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')
	)
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 16000);
}
export async function searchBlueprints(query: string) {
	const url = new URL('https://www.factorio.school/api/blueprintSummaries/search/page/1');
	url.searchParams.set('pageSize', '8');
	url.searchParams.set('text', query);
	const response = z
		.object({
			_data: z.array(
				z.object({
					key: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
					title: z.string(),
					descriptionMarkdown: z.string().optional()
				})
			)
		})
		.parse(JSON.parse(await fetchPublicWeb(url.href)));
	return {
		query,
		results: response._data.map((item) => ({
			title: item.title,
			url: `https://www.factorio.school/view/${item.key}`,
			description: item.descriptionMarkdown?.slice(0, 1000)
		})),
		untrusted: true
	};
}
const position = z.object({ x: z.number().finite(), y: z.number().finite() });
const sourceBlueprint = z
	.object({
		label: z.string().optional(),
		entities: z
			.array(z.object({ name: z.string(), position }).passthrough())
			.max(1000)
			.default([]),
		tiles: z
			.array(z.object({ name: z.string(), position }))
			.max(1024)
			.default([])
	})
	.passthrough();
export function selectWebBlueprint(encoded: string, path: number[]) {
	if (!/^0[A-Za-z0-9+/=]+$/.test(encoded) || encoded.length > 1024 * 1024)
		throw new Error('Invalid or oversized blueprint string');
	let node: unknown = JSON.parse(
		inflateSync(Buffer.from(encoded.slice(1), 'base64'), {
			maxOutputLength: 8 * 1024 * 1024
		}).toString('utf8')
	);
	const book = z.object({
		blueprint_book: z.object({
			label: z.string().optional(),
			blueprints: z.array(z.object({ index: z.number().int() }).passthrough()).max(1000)
		})
	});
	for (const index of path) {
		const parsed = book.parse(node);
		node = parsed.blueprint_book.blueprints.find((entry) => entry.index === index);
		if (!node) throw new Error('Blueprint book entry not found');
	}
	const parsedBook = book.safeParse(node);
	if (parsedBook.success)
		return {
			book: parsedBook.data.blueprint_book.label,
			entries: parsedBook.data.blueprint_book.blueprints.slice(0, 50).map((entry) => ({
				index: entry.index,
				label: z
					.object({ label: z.string().optional() })
					.safeParse(entry.blueprint ?? entry.blueprint_book).data?.label
			})),
			total: parsedBook.data.blueprint_book.blueprints.length
		};
	const blueprint = z.object({ blueprint: sourceBlueprint }).parse(node).blueprint;
	if (!blueprint.entities.length && !blueprint.tiles.length) throw new Error('Empty blueprint');
	const string = `0${deflateSync(JSON.stringify({ blueprint })).toString('base64')}`;
	return { blueprint, string };
}
export async function schoolBlueprint(urlValue: string, path: number[]) {
	const url = publicWebUrl(urlValue);
	if (
		![
			'factorio.school',
			'www.factorio.school',
			'factorioprints.com',
			'www.factorioprints.com'
		].includes(url.hostname)
	)
		throw new Error('Use a Factorio School or Factorio Prints blueprint URL');
	const id = /^\/view\/([A-Za-z0-9_-]{1,80})\/?$/.exec(url.pathname)?.[1];
	if (!id) throw new Error('Use the blueprint’s /view/ URL');
	const record = z
		.object({
			title: z.string(),
			descriptionMarkdown: z.string().optional(),
			blueprintString: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) })
		})
		.parse(
			JSON.parse(await fetchPublicWeb(`https://www.factorio.school/api/blueprintDetails/${id}`))
		);
	const encoded = z
		.object({ blueprintString: z.string() })
		.parse(
			JSON.parse(
				await fetchPublicWeb(
					`https://www.factorio.school/api/blueprintStringBySha/${record.blueprintString.sha}`
				)
			)
		);
	return {
		source: url.href,
		title: record.title,
		description: record.descriptionMarkdown?.slice(0, 8000),
		untrusted: true,
		...selectWebBlueprint(encoded.blueprintString, path)
	};
}
