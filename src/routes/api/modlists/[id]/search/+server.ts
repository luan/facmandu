import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, userHasModlistAccess } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { searchFactorioMods } from '$lib/server/factorio-search';
import { PortalHttpError } from '$lib/server/portal-cache';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	// Verify user session
	if (!event.locals.session) {
		return json({ message: 'unauthorized' }, { status: 401 });
	}

	const modlistId = event.params.id;
	if (!modlistId) {
		return json({ message: 'modlist id required' }, { status: 400 });
	}

	// Verify user access
	const hasAccess = await userHasModlistAccess(event.locals.session.userId, modlistId);
	if (!hasAccess) {
		const modlist = await db
			.select({ publicRead: table.modList.publicRead })
			.from(table.modList)
			.where(eq(table.modList.id, modlistId))
			.get();
		if (!modlist?.publicRead) return json({ message: 'Access denied' }, { status: 403 });
	}

	// Retrieve user factorio credentials
	const user = await db
		.select({
			factorioUsername: table.user.factorioUsername,
			factorioToken: table.user.factorioToken
		})
		.from(table.user)
		.where(eq(table.user.id, event.locals.session.userId))
		.get();

	if (!user?.factorioUsername || !user?.factorioToken) {
		return json(
			{ message: 'Connect your Factorio account in Account settings to search the portal.' },
			{ status: 400 }
		);
	}

	try {
		const search = await searchFactorioMods(event.url.searchParams, {
			username: user.factorioUsername,
			token: user.factorioToken
		});
		return json(search, { headers: { 'Cache-Control': 'private, max-age=300' } });
	} catch (cause) {
		if (cause instanceof PortalHttpError && [401, 403].includes(cause.status))
			return json(
				{
					message: 'Factorio rejected your credentials. Reconnect your account in Account settings.'
				},
				{ status: 401 }
			);
		console.error('Factorio search failed:', cause);
		return json(
			{ message: 'The mod portal search is unavailable. Try again shortly.' },
			{ status: 503 }
		);
	}
};
