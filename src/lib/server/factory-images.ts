import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { type FactoryImage, factoryImageSchema } from '#lib/factory-images.js';
import { publishActivity } from './activity';
import type { ManagedServer } from './db/schema';
import { blueprintImageData, pngDimensions } from './factory-image-data';
import { prototypeFingerprint } from './prototype-icons';
import { ServerError } from './server-files';
import { executable } from './server-process';

const run = promisify(execFile);
const renders = new Map<string, Promise<FactoryImage>>();
const renderer = join(homedir(), '.local/share/facmandu-renderer/current/render.py');
export class FactoryImagePending extends ServerError {
	constructor(readonly imageId: string) {
		super(425, 'Factory image is still rendering');
	}
}
export const factoryImageRendering = (serverId: string, id: string) =>
	renders.has(`${serverId}:${id}`);
export const factoryImagePath = (server: ManagedServer, id: string) => {
	if (!/^[a-f0-9]{64}$/u.test(id)) throw new ServerError(400, 'Invalid image identifier');
	return join(server.directory, 'factory-images', `${id}.png`);
};
export const factoryModelImagePath = (server: ManagedServer, id: string) =>
	factoryImagePath(server, id).replace(/\.png$/u, '.jpg');
async function prepareModelImage(server: ManagedServer, id: string) {
	const destination = factoryModelImagePath(server, id);
	try {
		await access(destination);
		return;
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
	}
	const temporary = `${destination}.${randomUUID()}.tmp`;
	try {
		// Pillow is available on Beast. Preserve the full PNG for players;
		// bounded JPEG previews keep repeated vision requests below upstream body limits.
		await run(
			'python3',
			[
				'-c',
				`
from PIL import Image
from io import BytesIO
import sys
image = Image.open(sys.argv[1]).convert('RGB')
image.thumbnail((1280, 1280))
while True:
    output = BytesIO()
    image.save(output, 'JPEG', quality=82)
    if output.tell() <= 384 * 1024:
        break
    image.thumbnail((int(image.width * .8), int(image.height * .8)))
with open(sys.argv[2], 'wb') as file:
    file.write(output.getvalue())
`,
				factoryImagePath(server, id),
				temporary
			],
			{ timeout: 10000, maxBuffer: 65536 }
		);
		await rename(temporary, destination);
	} finally {
		await rm(temporary, { force: true });
	}
}
export async function readFactoryImage(server: ManagedServer, id: string) {
	const png = await readFile(factoryImagePath(server, id));
	pngDimensions(png);
	return png;
}

export async function renderFactoryBlueprint(
	server: ManagedServer,
	encoded: string,
	waitMs = 60000
): Promise<FactoryImage> {
	let data: ReturnType<typeof blueprintImageData>;
	try {
		data = blueprintImageData(encoded);
	} catch (cause) {
		throw new ServerError(400, cause instanceof Error ? cause.message : 'Invalid blueprint');
	}
	const fingerprint = await prototypeFingerprint(server);
	const json = JSON.stringify(data);
	const id = createHash('sha256').update(`fbsr-v1:${fingerprint}:${json}`).digest('hex');
	try {
		const image = { id, ...pngDimensions(await readFactoryImage(server, id)) };
		await prepareModelImage(server, id);
		return image;
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
	}
	const key = `${server.id}:${id}`;
	let pending = renders.get(key);
	if (!pending) {
		pending = (async () => {
			const directory = join(server.directory, 'factory-images');
			await mkdir(directory, { recursive: true, mode: 0o700 });
			const staging = join(directory, `.render-${randomUUID()}`);
			const activity = {
				scope: 'server' as const,
				targetId: server.id,
				task: `render-${id}`,
				completed: 0,
				total: 1
			};
			publishActivity({
				...activity,
				state: 'running',
				message: 'Preparing sprites and rendering factory view'
			});
			await mkdir(staging, { mode: 0o700 });
			try {
				await writeFile(join(staging, 'blueprint.json'), json, { mode: 0o600 });
				await run(
					'python3',
					[
						renderer,
						'--binary',
						await executable(server),
						'--mods',
						join(server.directory, 'mods'),
						'--profile',
						join(server.directory, 'sprite-cache', fingerprint),
						'--input',
						join(staging, 'blueprint.json'),
						'--output',
						join(staging, 'image.png')
					],
					{ timeout: 600000, maxBuffer: 1024 * 1024 }
				);
				if ((await prototypeFingerprint(server)) !== fingerprint)
					throw new ServerError(409, 'Server mods changed while rendering; capture another view');
				const image = { id, ...pngDimensions(await readFile(join(staging, 'image.png'))) };
				await rename(join(staging, 'image.png'), factoryImagePath(server, id));
				await prepareModelImage(server, id);
				publishActivity({
					...activity,
					completed: 1,
					state: 'done',
					message: 'Factory image ready'
				});
				return factoryImageSchema.parse(image);
			} catch (cause) {
				publishActivity({
					...activity,
					state: 'error',
					message: 'Factory image could not be rendered'
				});
				if (cause instanceof ServerError) throw cause;
				console.error(
					'Factory rendering failed:',
					cause instanceof Error ? cause.message.slice(-300) : 'Unknown error'
				);
				throw new ServerError(
					503,
					(cause instanceof Error &&
						/FACMANDU_RENDER_ERROR: ([^\n]{1,400})/u.exec(cause.message)?.[1]) ||
						'Sprite rendering failed for this layout. Check the renderer’s installed version and supported mod sprites.'
				);
			} finally {
				await rm(staging, { recursive: true, force: true });
			}
		})();
		renders.set(key, pending);
		void pending.finally(() => renders.delete(key)).catch(() => {});
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			pending,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(new FactoryImagePending(id)), waitMs);
			})
		]);
	} finally {
		clearTimeout(timer);
	}
}
