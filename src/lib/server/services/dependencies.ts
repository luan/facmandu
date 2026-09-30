import {
	inspectDependencies,
	isBundledMod,
	satisfiesVersion,
	supportsFactorio
} from '$lib/dependencies';
import type { Mod } from '$lib/server/db/schema';

export { parseDependencies } from '$lib/dependencies';

export function validateDependencies(
	mods: (Pick<Mod, 'name' | 'enabled' | 'dependencies' | 'version'> & {
		factorioVersion?: string | null;
	})[],
	factorioVersion?: string
): {
	compatibilityIssues: { mod: string; actual: string; target: string }[];
	missingDependencies: string[];
	conflicts: { mod: string; conflictsWith: string }[];
	conflictingMods: string[];
	metadataErrors: { mod: string; message: string }[];
	versionIssues: { mod: string; dependency: string; requirement: string; actual: string | null }[];
} {
	const enabledMods = mods.filter((m) => m.enabled);
	const enabledByName = new Map(enabledMods.map((m) => [m.name, m]));
	const missingDeps = new Set<string>();
	const conflicts: { mod: string; conflictsWith: string }[] = [];
	const conflicting = new Set<string>();
	const compatibilityIssues: { mod: string; actual: string; target: string }[] = [];
	const metadataErrors: { mod: string; message: string }[] = [];
	const versionIssues: {
		mod: string;
		dependency: string;
		requirement: string;
		actual: string | null;
	}[] = [];

	for (const mod of enabledMods) {
		if (!isBundledMod(mod.name)) {
			if (mod.dependencies === null)
				metadataErrors.push({ mod: mod.name, message: 'Dependency metadata is missing' });
			if (
				factorioVersion &&
				mod.factorioVersion &&
				!supportsFactorio(mod.factorioVersion, factorioVersion)
			)
				compatibilityIssues.push({
					mod: mod.name,
					actual: mod.factorioVersion,
					target: factorioVersion
				});
		}
		const parsed = inspectDependencies(mod.dependencies);
		for (const message of parsed.errors) metadataErrors.push({ mod: mod.name, message });
		for (const dep of parsed.dependencies) {
			const installed = enabledByName.get(dep.name);
			if (dep.type === 'required' && !isBundledMod(dep.name) && !installed) {
				missingDeps.add(dep.name);
			}
			if (dep.type === 'conflict' && installed) {
				conflicts.push({ mod: mod.name, conflictsWith: dep.name });
				conflicting.add(mod.name);
				conflicting.add(dep.name);
			}
			// Bundled versions belong to the server installation and are checked when reviewing an apply.
			if (
				dep.version &&
				!isBundledMod(dep.name) &&
				installed &&
				!satisfiesVersion(installed.version ?? '', dep.version)
			) {
				versionIssues.push({
					mod: mod.name,
					dependency: dep.name,
					requirement: `${dep.version.operator} ${dep.version.version}`,
					actual: installed.version
				});
			}
		}
	}

	return {
		compatibilityIssues,
		missingDependencies: [...missingDeps],
		conflicts,
		conflictingMods: [...conflicting],
		metadataErrors,
		versionIssues
	};
}
