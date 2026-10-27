import { beginDropbox } from '#lib/server/dropbox.js';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = beginDropbox;
