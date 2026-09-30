import {
	compareVersions,
	inspectDependencies,
	isBundledMod,
	satisfiesVersion,
	supportsFactorio,
	type VersionRequirement
} from './dependencies';

export type ResolutionMod = {
	name: string;
	enabled: boolean | null;
	icebox: boolean | null;
	version: string | null;
};
export type ResolutionRelease = {
	version: string;
	factorioVersion: string;
	dependencies: string[];
};
export type ReleaseCatalog = { releases: ResolutionRelease[]; complete: boolean };
export type ResolutionIssue = { mod: string; message: string };

/** Resolve required dependencies from known metadata. The caller supplies missing catalogs. */
export function resolveModList(
	mods: ResolutionMod[],
	catalogs: ReadonlyMap<string, ReleaseCatalog>,
	factorioVersion: string,
	updateNames: ReadonlySet<string> = new Set()
) {
	const original = new Map(mods.map((mod) => [mod.name, mod]));
	const roots = new Set(
		mods
			.filter((mod) => mod.enabled && !mod.icebox && !isBundledMod(mod.name))
			.map((mod) => mod.name)
	);
	let selected = new Map<string, ResolutionRelease>();
	const seen = new Set<string>();
	const missingMetadata = new Set<string>();
	let issues: ResolutionIssue[] = [];
	let stable = false;

	// Cycles are allowed. A repeated changing assignment means constraints cannot converge.
	for (let pass = 0; pass < 100; pass++) {
		issues = [];
		missingMetadata.clear();
		const wanted = new Set(roots);
		const requirements = new Map<string, VersionRequirement[]>();
		const queue = [...roots];
		for (const name of queue) {
			const release = selected.get(name);
			if (!release) continue;
			for (const dependency of inspectDependencies(JSON.stringify(release.dependencies))
				.dependencies) {
				if (isBundledMod(dependency.name) || dependency.type === 'conflict') continue;
				if (dependency.type === 'required' && !wanted.has(dependency.name)) {
					wanted.add(dependency.name);
					queue.push(dependency.name);
				}
				if (dependency.version) {
					const current = requirements.get(dependency.name) ?? [];
					current.push(dependency.version);
					requirements.set(dependency.name, current);
				}
			}
		}
		if (wanted.size > 1000) {
			issues.push({
				mod: '',
				message: 'Dependency graph exceeds 1,000 mods; review this list manually.'
			});
			break;
		}
		const next = new Map<string, ResolutionRelease>();
		for (const name of wanted) {
			const catalog = catalogs.get(name);
			if (!catalog) {
				missingMetadata.add(name);
				continue;
			}
			const versions = requirements.get(name) ?? [];
			const candidates = catalog.releases.filter(
				(release) =>
					compareVersions(release.version, release.version) !== null &&
					supportsFactorio(release.factorioVersion, factorioVersion) &&
					versions.every((requirement) => satisfiesVersion(release.version, requirement)) &&
					!inspectDependencies(JSON.stringify(release.dependencies)).errors.length
			);
			const current = updateNames.has(name) ? undefined : original.get(name)?.version;
			const choice =
				candidates.find((release) => release.version === current) ??
				candidates.toSorted((a, b) => compareVersions(b.version, a.version) ?? 0)[0];
			if (choice) next.set(name, choice);
			else if (!catalog.complete) missingMetadata.add(name);
			else
				issues.push({
					mod: name,
					message: `No release supports Factorio ${factorioVersion}${versions.length ? ` and ${versions.map((item) => `${item.operator} ${item.version}`).join(', ')}` : ''}`
				});
		}
		const signature = JSON.stringify(
			[...next].map(([name, release]) => [name, release.version]).sort()
		);
		const previous = JSON.stringify(
			[...selected].map(([name, release]) => [name, release.version]).sort()
		);
		selected = next;
		if (signature === previous) {
			stable = true;
			break;
		}
		if (seen.has(signature)) {
			issues.push({
				mod: '',
				message:
					'Dependency versions cannot be resolved together. Review the reported requirements.'
			});
			break;
		}
		seen.add(signature);
	}
	if (!stable && !issues.length)
		issues.push({
			mod: '',
			message: 'Dependency resolution did not converge. Review this list manually.'
		});

	const blocked = new Set(issues.map((issue) => issue.mod));
	for (const [name, release] of selected) {
		for (const dependency of inspectDependencies(JSON.stringify(release.dependencies))
			.dependencies) {
			if (dependency.type === 'conflict' && selected.has(dependency.name)) {
				issues.push({ mod: name, message: `Conflicts with ${dependency.name}` });
				// Existing choices stay visible. Automatic additions never introduce a conflict.
				blocked.add(name);
				blocked.add(dependency.name);
			}
		}
	}
	for (let pass = 0; pass < selected.size; pass++) {
		let changed = false;
		for (const [name, release] of selected) {
			if (blocked.has(name)) continue;
			const unavailable = inspectDependencies(
				JSON.stringify(release.dependencies)
			).dependencies.find(
				(dependency) =>
					dependency.type === 'required' &&
					!isBundledMod(dependency.name) &&
					(blocked.has(dependency.name) || !selected.has(dependency.name))
			);
			if (unavailable) {
				blocked.add(name);
				issues.push({ mod: name, message: `Requires unresolved ${unavailable.name}` });
				changed = true;
			}
		}
		if (!changed) break;
	}
	const additions = [...selected.keys()].filter((name) => !roots.has(name) && !blocked.has(name));
	return { selected, additions, blocked, missingMetadata: [...missingMetadata], issues, stable };
}
