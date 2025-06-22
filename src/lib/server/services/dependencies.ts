import type { Mod } from '$lib/server/db/schema';

export type DependencyKind = 'required' | 'optional' | 'conflict';
export interface ParsedDependency {
	name: string;
	type: DependencyKind;
}

/**
 * Parse the `info.json` dependency list coming from Factorio mods.
 * The list is stored as JSON-encoded strings in the DB. Each string can contain
 * version constraints and prefixes that mark optional/conflict dependencies.
 */
export function parseDependencies(dependencyString: string | null): ParsedDependency[] {
	if (!dependencyString) return [];

	let rawDeps: string[];
	try {
		rawDeps = JSON.parse(dependencyString);
	} catch {
		return [];
	}

	return rawDeps.map((raw) => {
		// Strip version constraints so we only keep the name & prefix information
		let [name] = raw.split(/>=|>|<=|<|=/);
		name = name.trim();

		let type: DependencyKind = 'required';

		if (name.startsWith('!')) {
			name = name.slice(1).trim();
			type = 'conflict';
		} else if (name.startsWith('?') || name.startsWith('(?)')) {
			name = name.replace(/^\(\?\)|^\?/, '').trim();
			type = 'optional';
		} else if (name.startsWith('~')) {
			// Factorio treats "incompatibility" (~) similarly to required for activation
			name = name.slice(1).trim();
			type = 'required';
		}

		return { name, type };
	});
}

export function validateDependencies(mods: Pick<Mod, 'name' | 'enabled' | 'dependencies'>[]): {
	missingDependencies: string[];
	conflicts: { mod: string; conflictsWith: string }[];
	conflictingMods: string[];
} {
	const enabledMods = mods.filter((m) => m.enabled);
	const enabledSet = new Set(enabledMods.map((m) => m.name));

	const baseMods = new Set(['base', 'space-age', 'quality', 'elevated-rails']);

	const missingDeps: string[] = [];
	const conflicts: { mod: string; conflictsWith: string }[] = [];
	const conflicting = new Set<string>();

	for (const mod of enabledMods) {
		for (const dep of parseDependencies(mod.dependencies)) {
			if (dep.type === 'required') {
				if (!baseMods.has(dep.name) && !enabledSet.has(dep.name)) {
					if (!missingDeps.includes(dep.name)) missingDeps.push(dep.name);
				}
			} else if (dep.type === 'conflict') {
				if (enabledSet.has(dep.name)) {
					conflicts.push({ mod: mod.name, conflictsWith: dep.name });
					conflicting.add(mod.name);
					conflicting.add(dep.name);
				}
			}
		}
	}

	return {
		missingDependencies: missingDeps,
		conflicts,
		conflictingMods: Array.from(conflicting)
	};
}
