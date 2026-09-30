import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	await db.run(sql`SELECT 1`);
	return json(
		{ status: 'ok', revision: env.FACMANDU_REVISION ?? 'development' },
		{ headers: { 'Cache-Control': 'no-store' } }
	);
};
