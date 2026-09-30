import { createHash } from 'node:crypto';
import {
	compareVersions,
	inspectDependencies,
	isBundledMod,
	satisfiesVersion
} from '$lib/dependencies';
import { validModName } from '$lib/server/mod-names';
import { validateDependencies } from '$lib/server/services/dependencies';

export type DesiredMod = {
	name: string;
	enabled: boolean | null;
	icebox: boolean | null;
	version: string | null;
	factorioVersion: string | null;
	dependencies: string | null;
};
export type ServerMod = { name: string; enabled: boolean; version?: string };
export type ModChange =
	| { kind: 'install'; name: string; version: string; previous: string[] }
	| { kind: 'enable' | 'disable'; name: string };
export type ServerModState = {
	mods: ServerMod[];
	installed: Record<string, string[]>;
	unpacked?: Record<string, string[]>;
	bundled?: Record<string, { version: string; dependencies: string[] }>;
	factorioVersion: string;
};

export function planServerMods(
	desiredMods: DesiredMod[],
	server: ServerModState,
	listVersion: string
) {
	const desired = desiredMods
		.filter((mod) => mod.enabled && !mod.icebox)
		.toSorted((a, b) => a.name.localeCompare(b.name));
	const currentMods = server.mods.toSorted((a, b) => a.name.localeCompare(b.name));
	const desiredNames = new Set(desired.map((mod) => mod.name));
	const current = new Map(currentMods.map((mod) => [mod.name, mod.enabled]));
	const changes: ModChange[] = [];
	const problems: string[] = [];
	const bundled = new Map(
		currentMods.filter((mod) => isBundledMod(mod.name)).map((mod) => [mod.name, mod.enabled])
	);
	if (current.has('base')) bundled.set('base', true);
	const explicitBundled = new Map(
		desiredMods
			.filter((mod) => isBundledMod(mod.name) && mod.name !== 'base' && !mod.icebox)
			.map((mod) => [mod.name, !!mod.enabled])
	);
	for (const [name, enabled] of explicitBundled) bundled.set(name, enabled);
	const bundledRequirements = desired.flatMap((mod) =>
		inspectDependencies(mod.dependencies)
			.dependencies.filter((dependency) => isBundledMod(dependency.name))
			.map((dependency) => ({ owner: mod.name, dependency }))
	);
	const inspectedBundles = new Set<string>();
	for (let pass = 0; pass < 10; pass++) {
		for (const { owner, dependency } of bundledRequirements) {
			if (dependency.type !== 'required') continue;
			if (explicitBundled.get(dependency.name) === false)
				problems.push(`${owner} requires ${dependency.name}, which this list disables`);
			bundled.set(dependency.name, true);
		}
		const uninspected = [...bundled].filter(
			([name, enabled]) => enabled && !inspectedBundles.has(name)
		);
		if (!uninspected.length) break;
		for (const [name] of uninspected) {
			inspectedBundles.add(name);
			for (const dependency of inspectDependencies(
				JSON.stringify(server.bundled?.[name]?.dependencies ?? [])
			).dependencies) {
				if (isBundledMod(dependency.name)) bundledRequirements.push({ owner: name, dependency });
			}
		}
	}
	const branch = server.factorioVersion.split('.').slice(0, 2).join('.');
	if (branch !== listVersion)
		problems.push(
			`This list targets Factorio ${listVersion}; the server uses ${server.factorioVersion || 'an unknown version'}`
		);

	for (const mod of desired) {
		if (!validModName(mod.name)) problems.push(`Invalid mod name: ${mod.name}`);
		if (isBundledMod(mod.name)) {
			bundled.set(mod.name, true);
			continue;
		}
		if (!mod.version || compareVersions(mod.version, mod.version) === null)
			problems.push(`No known version for ${mod.name}`);
		if (mod.dependencies === null) problems.push(`Dependency metadata is missing for ${mod.name}`);
		if (
			mod.factorioVersion !== listVersion &&
			!(listVersion === '1.0' && mod.factorioVersion === '0.18')
		)
			problems.push(`${mod.name} has no release selected for Factorio ${listVersion}`);
		const installed = (server.installed[mod.name] ?? []).toSorted();
		const pinned = server.mods.find((item) => item.name === mod.name)?.version;
		const exact =
			installed.length === 1 && installed[0] === mod.version && (!pinned || pinned === mod.version);
		if (!exact && mod.version && compareVersions(mod.version, mod.version) !== null) {
			if (server.unpacked?.[mod.name]?.length)
				problems.push(
					`${mod.name} is an unpacked development mod. Move it out of the server mods directory before replacing its version.`
				);
			changes.push({ kind: 'install', name: mod.name, version: mod.version, previous: installed });
		} else if (!current.get(mod.name)) changes.push({ kind: 'enable', name: mod.name });
	}
	for (const { owner, dependency } of bundledRequirements) {
		if (!bundled.get(dependency.name)) continue;
		if (dependency.type === 'conflict')
			problems.push(`${owner} conflicts with enabled ${dependency.name}`);
		else if (
			dependency.version &&
			!satisfiesVersion(
				server.bundled?.[dependency.name]?.version || server.factorioVersion,
				dependency.version
			)
		)
			problems.push(
				`${owner} requires ${dependency.name} ${dependency.version.operator} ${dependency.version.version}`
			);
	}
	for (const [name, enabled] of bundled) {
		if (enabled && !current.has(name) && !server.bundled?.[name])
			problems.push(`Required bundled mod ${name} is unavailable on this server`);
		else if ((current.has(name) || server.bundled?.[name]) && current.get(name) !== enabled)
			changes.push({ kind: enabled ? 'enable' : 'disable', name });
	}
	// Factorio can enable an installed archive absent from mod-list.json on its next start.
	for (const name of new Set([...current.keys(), ...Object.keys(server.installed)])) {
		if (current.get(name) !== false && !isBundledMod(name) && !desiredNames.has(name))
			changes.push({ kind: 'disable', name });
	}
	const dependencies = validateDependencies(desired);
	problems.push(
		...dependencies.missingDependencies.map((name) => `Missing dependency: ${name}`),
		...dependencies.conflicts.map(
			({ mod, conflictsWith }) => `${mod} conflicts with ${conflictsWith}`
		),
		...dependencies.metadataErrors.map(({ mod, message }) => `${mod}: ${message}`),
		...dependencies.versionIssues.map(
			({ mod, dependency, requirement, actual }) =>
				`${mod} requires ${dependency} ${requirement}; found ${actual ?? 'unknown version'}`
		)
	);
	const installed = Object.fromEntries(
		Object.entries(server.installed)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, versions]) => [name, versions.toSorted()])
	);
	const hash = createHash('sha256')
		.update(
			JSON.stringify({
				desired,
				serverMods: currentMods,
				bundled: server.bundled,
				unpacked: server.unpacked,
				installed,
				factorioVersion: server.factorioVersion,
				listVersion,
				changes,
				problems
			})
		)
		.digest('hex');
	return {
		changes,
		problems: [...new Set(problems)],
		hash,
		desiredCount: desired.length,
		serverCount: server.mods.filter((mod) => mod.enabled).length
	};
}
