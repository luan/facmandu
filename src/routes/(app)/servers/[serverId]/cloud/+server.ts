import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { publishActivity } from '$lib/server/activity';
import { authenticationForm, requireSameOrigin } from '$lib/server/auth';
import {
	disconnectDropbox,
	dropboxAccess,
	dropboxConfigured,
	hasDropbox
} from '$lib/server/dropbox';
import {
	backupToDropbox,
	cloudFileSchema,
	listDropboxSaves,
	restoreFromDropbox
} from '$lib/server/dropbox-backups';
import { ServerError } from '$lib/server/server-files';
import { requireStopped } from '$lib/server/server-process';
import { reserveServer, serverTask } from '$lib/server/server-tasks';
import { requireServer } from '$lib/server/servers';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
	if (!locals.user) error(401, 'Sign in first');
	const userId = locals.user.id;
	const server = await requireServer(userId, params.serverId);
	const connected = await hasDropbox(userId);
	if (!connected)
		return json({ configured: dropboxConfigured(), connected: false, saves: [], cursor: null });
	try {
		return json({
			configured: dropboxConfigured(),
			connected: true,
			...(await listDropboxSaves(
				server,
				await dropboxAccess(userId),
				url.searchParams.get('cursor') || undefined
			))
		});
	} catch (cause) {
		if (cause instanceof ServerError)
			return json(
				{ connected: true, configured: dropboxConfigured(), saves: [], message: cause.message },
				{ status: cause.status }
			);
		throw cause;
	}
};
export const POST: RequestHandler = async ({ locals, params, request, url }) => {
	requireSameOrigin(request, url);
	if (!locals.user) error(401, 'Sign in first');
	const userId = locals.user.id;
	const server = await requireServer(userId, params.serverId);
	const form = await authenticationForm(request);
	const operation = form.get('operation');
	if (!['backup', 'restore', 'disconnect'].includes(String(operation)))
		error(400, 'Invalid cloud operation');
	const release = reserveServer(server.id, 'Transferring cloud save');
	if (!release) error(409, serverTask(server.id) || 'Server busy');
	let handedOff = false;
	try {
		if (operation === 'disconnect') {
			await disconnectDropbox(userId);
			return json({ message: 'Dropbox disconnected. Backups were kept.' });
		}
		await requireStopped(server);
		if (!(await hasDropbox(userId))) error(409, 'Connect Dropbox first');
		const choice =
			operation === 'restore' ? cloudFileSchema.parse(JSON.parse(String(form.get('save')))) : null;
		const report = (state: 'running' | 'done' | 'error', message: string) =>
			publishActivity({
				scope: 'server',
				targetId: server.id,
				task: 'cloud-save',
				state,
				message,
				completed: state === 'done' ? 1 : 0,
				total: 1
			});
		report('running', operation === 'backup' ? 'Backing up to Dropbox' : 'Restoring cloud save');
		handedOff = true;
		void (async () => {
			try {
				await requireServer(userId, server.id);
				const result = choice
					? await restoreFromDropbox(server, userId, choice)
					: await backupToDropbox(server, userId);
				report(
					'done',
					'restored' in result
						? `Restored ${result.restored}${result.backup ? `; previous world kept as ${result.backup}` : ''}. Server remains stopped.`
						: `Dropbox backup verified: ${result.backup}`
				);
			} catch (cause) {
				report(
					'error',
					cause instanceof ServerError
						? cause.message
						: 'Cloud transfer failed. Existing saves were preserved.'
				);
			} finally {
				release();
			}
		})();
		return json({ requested: true }, { status: 202 });
	} catch (cause) {
		if (cause instanceof ServerError) error(cause.status, cause.message);
		if (cause instanceof z.ZodError || cause instanceof SyntaxError)
			error(400, 'Invalid cloud save selection');
		throw cause;
	} finally {
		if (!handedOff) release();
	}
};
