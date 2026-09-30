import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { and, eq, isNull, or } from 'drizzle-orm';
import { db, userHasModlistAccess } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { modArchive } from '$lib/server/mod-downloads';
import { getPortalMod } from '$lib/server/portal-cache';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	// Require authentication
	if (!event.locals.session) {
		return new Response('Unauthorized', { status: 401 });
	}

	const modlistId = event.params.id as string;
	const modName = event.params.modName;
	const version = event.params.version;

	// Access control (owner or collaborator)
	const hasAccess = await userHasModlistAccess(event.locals.session.userId, modlistId);
	if (!hasAccess) {
		return new Response('Forbidden', { status: 403 });
	}

	// Verify the mod is actually in this modlist and enabled
	const modInList = await db
		.select({ name: table.mod.name, version: table.mod.version })
		.from(table.mod)
		.where(
			and(
				eq(table.mod.modlist, modlistId),
				eq(table.mod.name, modName),
				eq(table.mod.enabled, true),
				or(isNull(table.mod.icebox), eq(table.mod.icebox, false))
			)
		)
		.get();

	if (!modInList) {
		return new Response('Mod not found in modlist or not enabled', { status: 404 });
	}

	// Get user's Factorio credentials
	const user = await db
		.select({
			factorioUsername: table.user.factorioUsername,
			factorioToken: table.user.factorioToken
		})
		.from(table.user)
		.where(eq(table.user.id, event.locals.session.userId))
		.get();

	try {
		const { data } = await getPortalMod(modName);
		const selected = version === 'latest' ? modInList.version : version;
		const release = data?.releases.find((item) => item.version === selected);
		if (!release)
			return new Response('Selected mod release is unavailable; repair this list first', {
				status: 422
			});
		const archive = await modArchive(
			modName,
			release,
			user?.factorioUsername && user.factorioToken
				? {
						username: user.factorioUsername,
						token: user.factorioToken
					}
				: null
		);
		return new Response(
			Readable.toWeb(createReadStream(archive.path)) as ReadableStream<Uint8Array>,
			{
				headers: {
					'Content-Type': 'application/zip',
					'Content-Length': String(archive.size),
					'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${modName}_${release.version}.zip`)}`,
					'X-Factorio-Mod-Version': release.version,
					'Cache-Control':
						version === 'latest' ? 'private, no-cache' : 'private, max-age=31536000, immutable'
				}
			}
		);
	} catch (cause) {
		console.error('Mod download failed:', cause instanceof Error ? cause.message : 'unknown error');
		return new Response('Could not prepare the mod download', { status: 502 });
	}
};
