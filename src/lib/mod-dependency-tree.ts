import { type ParsedDependency, parseDependencies } from './dependencies';

export type DependencyMod = {
	name: string;
	title: string | null;
	dependencies: string | null;
	enabled: boolean | null;
};

export function modDependencyGraph<T extends DependencyMod>(mods: T[]) {
	const byName = new Map(mods.map((mod) => [mod.name, mod]));
	const children = new Map<string, ParsedDependency[]>();
	const requiredBy = new Map<string, T[]>();
	const dependents = new Map<string, T[]>();
	const nested = new Set<string>();
	for (const mod of mods) {
		const dependencies = parseDependencies(mod.dependencies).filter(
			(dep) => dep.name !== 'base' && dep.type === 'required'
		);
		children.set(mod.name, dependencies);
		for (const dep of dependencies) {
			nested.add(dep.name);
			const references = dependents.get(dep.name) ?? [];
			if (!references.includes(mod)) references.push(mod);
			dependents.set(dep.name, references);
			if (!mod.enabled) continue;
			const parents = requiredBy.get(dep.name) ?? [];
			if (!parents.includes(mod)) parents.push(mod);
			requiredBy.set(dep.name, parents);
		}
	}
	const sorted = [...mods].sort((a, b) => (a.title || a.name).localeCompare(b.title || b.name));
	const roots = sorted.filter((mod) => !nested.has(mod.name));
	const reached = new Set<string>();
	function visit(name: string) {
		if (reached.has(name)) return;
		reached.add(name);
		for (const dep of children.get(name) ?? []) visit(dep.name);
	}
	for (const root of roots) visit(root.name);
	// A disconnected cycle has no natural root, but still needs to be visible.
	for (const mod of sorted)
		if (!reached.has(mod.name)) {
			roots.push(mod);
			visit(mod.name);
		}
	return { byName, children, requiredBy, dependents, roots };
}

export function dependencyTreeMatches(
	children: Map<string, ParsedDependency[]>,
	matches: Set<string>
): Set<string> {
	const visible = new Set(matches);
	const parents = new Map<string, string[]>();
	for (const [name, dependencies] of children)
		for (const dep of dependencies) {
			const names = parents.get(dep.name) ?? [];
			names.push(name);
			parents.set(dep.name, names);
		}
	const pending = [...matches];
	while (pending.length) {
		const name = pending.pop();
		if (!name) continue;
		for (const parent of parents.get(name) ?? []) {
			if (visible.has(parent)) continue;
			visible.add(parent);
			pending.push(parent);
		}
	}
	return visible;
}
