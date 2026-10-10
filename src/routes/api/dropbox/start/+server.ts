import { beginDropbox } from '$lib/server/dropbox';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = beginDropbox;
