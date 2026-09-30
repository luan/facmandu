import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { error, json } from '@sveltejs/kit';
import { and, eq, isNull, or } from 'drizzle-orm';
import { db, userHasModlistAccess } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { exportPath, exportProgress, prepareExport } from '$lib/server/mod-export';
import type { RequestEvent, RequestHandler } from './$types';

async function authorize(event: RequestEvent) {
	const userId = event.locals.session?.userId;
	if (!userId) error(401, 'Sign in to export mods');
	if (!(await userHasModlistAccess(userId, event.params.id)))
		error(403, 'You cannot export this list');
	return userId;
}

export const POST: RequestHandler = async (event) => {
	const userId = await authorize(event);
	const [mods, user] = await Promise.all([
		db
			.select({ name: table.mod.name, version: table.mod.version, enabled: table.mod.enabled })
			.from(table.mod)
			.where(
				and(
					eq(table.mod.modlist, event.params.id),
					or(isNull(table.mod.icebox), eq(table.mod.icebox, false))
				)
			),
		db
			.select({ username: table.user.factorioUsername, token: table.user.factorioToken })
			.from(table.user)
			.where(eq(table.user.id, userId))
			.get()
	]);
	try {
		const progress = await prepareExport(
			event.params.id,
			mods,
			user?.username && user.token ? { username: user.username, token: user.token } : null
		);
		return json(progress, { status: progress.state === 'running' ? 202 : 200 });
	} catch (cause) {
		error(422, cause instanceof Error ? cause.message : 'Could not prepare mod bundle');
	}
};

export const GET: RequestHandler = async (event) => {
	await authorize(event);
	const id = event.url.searchParams.get('download') ?? event.url.searchParams.get('job');
	if (!id || !/^[a-f0-9]{64}$/u.test(id)) error(400, 'Invalid export');
	// Each export hash includes its list, and access is checked again for every download.
	const progress = exportProgress(id);
	if (!progress || progress.listId !== event.params.id)
		error(404, 'Prepare this export again to restore its download link');
	if (event.url.searchParams.has('job')) return json(progress);
	if (progress.state !== 'done') error(409, 'This export is not ready');
	const file = await stat(exportPath(id)).catch(() => null);
	if (!file) error(404, 'Prepare this export again');
	return new Response(
		Readable.toWeb(createReadStream(exportPath(id))) as ReadableStream<Uint8Array>,
		{
			headers: {
				'Content-Type': 'application/gzip',
				'Content-Disposition': 'attachment; filename="facmandu-mods.tar.gz"',
				'Content-Length': String(file.size),
				'Cache-Control': 'no-store'
			}
		}
	);
};
