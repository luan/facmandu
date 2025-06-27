import { db } from '$lib/server/db';
import { eq } from 'drizzle-orm';
import * as table from '$lib/server/db/schema';
import { userHasModlistAccess } from '$lib/server/db';
import type { RequestHandler } from './$types';

interface ReleaseInfo {
	version: string;
	download_url: string;
}

async function getReleaseDownloadPath(modName: string, version: string): Promise<string | null> {
	try {
		// Validate mod name format to prevent injection
		if (!/^[a-zA-Z0-9_-]+$/.test(modName) || modName.length > 100) {
			return null;
		}

		const res = await fetch(`https://mods.factorio.com/api/mods/${modName}`);
		if (!res.ok) return null;
		const data = (await res.json()) as { releases: ReleaseInfo[] };
		if (!data?.releases?.length) return null;

		let release: ReleaseInfo | undefined;
		if (version && version !== 'latest') {
			release = data.releases.find((r) => r.version === version);
		}
		if (!release) {
			// fallback to latest
			release = data.releases[data.releases.length - 1];
		}
		return release?.download_url ?? null;
	} catch {
		return null;
	}
}

export const GET: RequestHandler = async (event) => {
	// Require authentication
	if (!event.locals.session) {
		return new Response('Unauthorized', { status: 401 });
	}

	const modlistId = event.params.id as string;
	const modName = decodeURIComponent(event.params.modName as string);
	const version = decodeURIComponent(event.params.version as string);

	// Access control (owner or collaborator)
	const hasAccess = await userHasModlistAccess(event.locals.session.userId, modlistId);
	if (!hasAccess) {
		return new Response('Forbidden', { status: 403 });
	}

	// Verify the mod is actually in this modlist and enabled
	const modInList = await db
		.select({ name: table.mod.name })
		.from(table.mod)
		.where(
			eq(table.mod.modlist, modlistId) && eq(table.mod.name, modName) && eq(table.mod.enabled, true)
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

	if (!user?.factorioUsername || !user?.factorioToken) {
		return new Response('User does not have Factorio credentials configured', { status: 422 });
	}

	// Get the download path from Factorio API
	const downloadPath = await getReleaseDownloadPath(modName, version);
	if (!downloadPath) {
		return new Response('Mod release not found', { status: 404 });
	}

	try {
		// Proxy the download request with credentials
		const downloadUrl = `https://mods.factorio.com${downloadPath}?username=${user.factorioUsername}&token=${user.factorioToken}`;
		const response = await fetch(downloadUrl);

		if (!response.ok) {
			return new Response('Failed to download mod', { status: response.status });
		}

		// Stream the response back to the client
		return new Response(response.body, {
			status: response.status,
			headers: {
				'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
				'Content-Length': response.headers.get('Content-Length') || '',
				'Content-Disposition':
					response.headers.get('Content-Disposition') || `attachment; filename="${modName}.zip"`
			}
		});
	} catch (error) {
		console.error('Download proxy error:', error);
		return new Response('Download failed', { status: 500 });
	}
};
