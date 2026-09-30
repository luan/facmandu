export type DependencyKind = 'required' | 'optional' | 'conflict';
export type VersionOperator = '<' | '<=' | '=' | '>=' | '>';
export type VersionRequirement = { operator: VersionOperator; version: string };
export type ParsedDependency = { name: string; type: DependencyKind; version?: VersionRequirement };
export type DependencyParseResult = { dependencies: ParsedDependency[]; errors: string[] };

const bundledMods = new Map([
	['base', 'Factorio'],
	['elevated-rails', 'Elevated Rails'],
	['quality', 'Quality'],
	['recycler', 'Recycler'],
	['space-age', 'Space Age']
]);
export const bundledModTitle = (name: string) => bundledMods.get(name);
export const isBundledMod = (name: string) => bundledMods.has(name);
export const supportsFactorio = (releaseVersion: string, targetVersion: string) =>
	releaseVersion === targetVersion || (releaseVersion === '0.18' && targetVersion === '1.0');
const versionPattern = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/u;
const dependencyPattern =
	/^(\(\?\)|[!?+~])?\s*([^<>=]+?)(?:\s*(<=|>=|<|>|=)\s*(\d+(?:\.\d+){0,2}))?$/u;

export function compareVersions(left: string, right: string): number | null {
	if (!versionPattern.test(left) || !versionPattern.test(right)) return null;
	const a = left.split('.').map(Number);
	const b = right.split('.').map(Number);
	if ([...a, ...b].some((part) => part > 65535)) return null;
	for (let i = 0; i < 3; i++) {
		const leftPart = a[i];
		const rightPart = b[i];
		if (leftPart === undefined || rightPart === undefined) return null;
		if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
	}
	return 0;
}

export function satisfiesVersion(version: string, requirement: VersionRequirement): boolean {
	const comparison = compareVersions(version, requirement.version);
	if (comparison === null) return false;
	switch (requirement.operator) {
		case '<':
			return comparison < 0;
		case '<=':
			return comparison <= 0;
		case '=':
			return comparison === 0;
		case '>=':
			return comparison >= 0;
		case '>':
			return comparison > 0;
	}
}

export function inspectDependencies(encoded: string | null): DependencyParseResult {
	if (encoded === null) return { dependencies: [], errors: [] };
	let raw: unknown;
	try {
		raw = JSON.parse(encoded);
	} catch {
		return { dependencies: [], errors: ['Dependency metadata is not valid JSON'] };
	}
	if (!Array.isArray(raw))
		return { dependencies: [], errors: ['Dependency metadata is not a list'] };

	const dependencies: ParsedDependency[] = [];
	const errors: string[] = [];
	for (const value of raw) {
		if (typeof value !== 'string') {
			errors.push('Dependency entry is not text');
			continue;
		}
		const match = dependencyPattern.exec(value.trim());
		// Dependency constraints accept abbreviated versions, unlike release identifiers.
		const normalized = match?.[4]
			? [...match[4].split('.'), '0', '0'].slice(0, 3).join('.')
			: undefined;
		const name = match?.[2]?.trim();
		if (!name || (normalized && compareVersions(normalized, normalized) === null)) {
			errors.push(`Invalid dependency: ${value}`);
			continue;
		}
		const prefix = match?.[1];
		const operator = match?.[3];
		const type: DependencyKind =
			prefix === '!'
				? 'conflict'
				: prefix === '?' || prefix === '(?)' || prefix === '+'
					? 'optional'
					: 'required';
		dependencies.push({
			name,
			type,
			...(operator && normalized && type !== 'conflict'
				? { version: { operator: operator as VersionOperator, version: normalized } }
				: {})
		});
	}
	return { dependencies, errors };
}

export function parseDependencies(encoded: string | null): ParsedDependency[] {
	return inspectDependencies(encoded).dependencies;
}
