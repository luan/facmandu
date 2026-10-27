import { error } from '@sveltejs/kit';
import { finishDropbox } from '#lib/server/dropbox.js';
import { ServerError } from '#lib/server/server-files.js';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async (event) => {
	try {
		return await finishDropbox(event);
	} catch (cause) {
		if (cause instanceof ServerError) error(cause.status, cause.message);
		throw cause;
	}
};
