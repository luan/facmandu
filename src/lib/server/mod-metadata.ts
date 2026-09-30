import { compareVersions, inspectDependencies, supportsFactorio } from '$lib/dependencies';
import type { PortalMod, PortalRelease } from '$lib/server/portal-cache';

export function latestCompatibleRelease(
	info: PortalMod,
	factorioVersion: string
): PortalRelease | undefined {
	return info.releases
		.filter(
			(release) =>
				compareVersions(release.version, release.version) !== null &&
				supportsFactorio(release.info_json.factorio_version, factorioVersion) &&
				!inspectDependencies(JSON.stringify(release.info_json.dependencies)).errors.length
		)
		.toSorted((a, b) => compareVersions(b.version, a.version) ?? 0)[0];
}

export function modMetadataValues(info: PortalMod, release: PortalRelease, fetchedAt: number) {
	// These columns store whole seconds. Normalize before comparing cached records for changes.
	const timestamp = (value: number) => new Date(Math.floor(value / 1000) * 1000);
	return {
		title: info.title,
		summary: info.summary ?? null,
		description: info.description ?? null,
		category: info.category ?? null,
		tags: info.tags ? JSON.stringify(info.tags) : null,
		thumbnail: info.thumbnail ?? null,
		downloadsCount: info.downloads_count ?? null,
		lastUpdated: info.updated_at ? timestamp(Date.parse(info.updated_at)) : null,
		version: release.version,
		factorioVersion: release.info_json.factorio_version,
		dependencies: JSON.stringify(release.info_json.dependencies),
		lastFetched: timestamp(fetchedAt),
		fetchError: null
	};
}
