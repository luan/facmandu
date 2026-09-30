import {
	compareVersions,
	inspectDependencies,
	isBundledMod,
	satisfiesVersion,
	supportsFactorio,
	type VersionRequirement
} from './dependencies';

export const recommendationPageSize = 12;

export type RecommendationMod = {
	name: string;
	enabled: boolean | null;
	dependencies: string | null;
};
export type RecommendationCandidate = {
	name: string;
	recommendedBy: string[];
	requirements: VersionRequirement[];
};
export function recommendationCandidates(mods: RecommendationMod[]) {
	const existing = new Set(mods.map((mod) => mod.name));
	const candidates = new Map<string, RecommendationCandidate>();
	const conflicts = new Set<string>();
	for (const mod of mods.filter((item) => item.enabled)) {
		for (const dependency of inspectDependencies(mod.dependencies).dependencies) {
			if (dependency.type === 'conflict') conflicts.add(dependency.name);
			if (
				dependency.type !== 'optional' ||
				existing.has(dependency.name) ||
				isBundledMod(dependency.name)
			)
				continue;
			const candidate = candidates.get(dependency.name) ?? {
				name: dependency.name,
				recommendedBy: [],
				requirements: []
			};
			if (!candidate.recommendedBy.includes(mod.name)) candidate.recommendedBy.push(mod.name);
			if (dependency.version) candidate.requirements.push(dependency.version);
			candidates.set(dependency.name, candidate);
		}
	}
	return [...candidates.values()]
		.filter((candidate) => !conflicts.has(candidate.name))
		.sort(
			(a, b) => b.recommendedBy.length - a.recommendedBy.length || a.name.localeCompare(b.name)
		);
}

export function recommendationRelease<
	T extends { version: string; info_json: { factorio_version: string; dependencies: string[] } }
>(
	releases: T[],
	candidate: RecommendationCandidate,
	mods: RecommendationMod[],
	factorioVersion: string
): T | undefined {
	const enabled = new Set(mods.filter((mod) => mod.enabled).map((mod) => mod.name));
	return releases
		.filter((release) => {
			const parsed = inspectDependencies(JSON.stringify(release.info_json.dependencies));
			return (
				supportsFactorio(release.info_json.factorio_version, factorioVersion) &&
				compareVersions(release.version, release.version) !== null &&
				!parsed.errors.length &&
				candidate.requirements.every((requirement) =>
					satisfiesVersion(release.version, requirement)
				) &&
				!parsed.dependencies.some(
					(dependency) => dependency.type === 'conflict' && enabled.has(dependency.name)
				)
			);
		})
		.sort((a, b) => compareVersions(b.version, a.version) ?? 0)[0];
}

// A ranking heuristic, not a probability that the player will like a mod.
export function recommendationPriority(rating: { score: number; confidence: number } | undefined) {
	// Confidence has more influence than fit without promoting confidently poor matches.
	return rating ? rating.score * rating.confidence ** 2 : -1;
}
