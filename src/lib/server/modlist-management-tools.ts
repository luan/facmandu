import { createHash } from 'node:crypto';
import { useDelivery, useTool } from '@flue/runtime';
import { eq } from 'drizzle-orm';
import * as v from 'valibot';
import { compareVersions, supportsFactorio } from '$lib/dependencies';
import { recommendationCandidates, recommendationRelease } from '$lib/recommendations';
import { db } from './db';
import { user } from './db/schema';
import { searchFactorioMods } from './factorio-search';
import {
	applyModlistChanges,
	authorizedList,
	prepareModlistPlan,
	prepareTurnModlistPlan
} from './modlist-plans';
import { getPortalMod } from './portal-cache';
import { validateDependencies } from './services/dependencies';
export async function inspectList(userId: string, listId: string) {
	const { list, mods } = await authorizedList(userId, listId);
	return {
		name: list.name,
		factorioVersion: list.factorioVersion,
		mods: mods
			.filter((item) => item.name !== 'base')
			.map(({ name, title, enabled, icebox, essential, version, summary }) => ({
				name,
				title,
				enabled,
				icebox,
				essential,
				version,
				summary: summary?.slice(0, 350)
			})),
		issues: validateDependencies(
			mods.filter((item) => !item.icebox),
			list.factorioVersion
		)
	};
}
export function modlistManagementTools(
	context: { userId: string; chatId?: string },
	resolveList: () => Promise<string>,
	groups: ReadonlySet<string>
) {
	const delivery = useDelivery();
	const requestId = delivery.kind === 'signal' ? delivery.attributes?.requestId : undefined;
	useTool({
		name: 'inspect_list',
		description:
			'Read the current mod list, enabled/locked mods, descriptions and dependency issues. Read before advising or changing anything.',
		async run() {
			const listId = await resolveList();
			return { output: await inspectList(context.userId, listId) };
		}
	});
	useTool({
		name: 'inspect_mod',
		description:
			'Refresh portal metadata and releases for one exact mod name. Describe its concrete contribution, overlap, requirements and compatibility in this list.',
		input: v.object({ name: v.pipe(v.string(), v.maxLength(100)) }),
		async run({ data }) {
			const listId = await resolveList();
			const { list, mods } = await authorizedList(context.userId, listId);
			const { data: mod, warning } = await getPortalMod(data.name, true);
			if (!mod) throw new Error('Mod not found');
			const active = mods.filter((item) => !item.icebox);
			const candidate = recommendationCandidates(active).find((item) => item.name === mod.name) ?? {
				name: mod.name,
				requirements: [],
				recommendedBy: []
			};
			const release = recommendationRelease(mod.releases, candidate, active, list.factorioVersion);
			return {
				output: {
					kind: 'mods',
					mods: [
						{
							name: mod.name,
							title: mod.title,
							summary: mod.summary ?? '',
							reason: '',
							thumbnail: mod.thumbnail ?? null,
							version: warning ? null : (release?.version ?? null),
							factorioVersion: list.factorioVersion,
							enabled: active.some((item) => item.name === mod.name && item.enabled)
						}
					],
					name: mod.name,
					metadataWarning: warning ?? null,
					title: mod.title,
					summary: mod.summary,
					description: mod.description?.slice(0, 12000),
					releases: mod.releases.slice(-12).map((release) => ({
						version: release.version,
						factorioVersion: release.info_json.factorio_version,
						dependencies: release.info_json.dependencies
					}))
				}
			};
		}
	});
	if (groups.has('discover'))
		useTool({
			name: 'search_mods',
			description:
				'Search the Factorio portal for mods that match a concrete request. Results are cached. Do not assume a search result is compatible.',
			input: v.object({ query: v.pipe(v.string(), v.minLength(1), v.maxLength(200)) }),
			async run({ data }) {
				const listId = await resolveList();
				const { list } = await authorizedList(context.userId, listId);
				const account = await db
					.select({ username: user.factorioUsername, token: user.factorioToken })
					.from(user)
					.where(eq(user.id, context.userId))
					.get();
				return {
					output: await searchFactorioMods(
						new URLSearchParams({ q: data.query, version: list.factorioVersion, page_size: '10' }),
						account?.username && account.token
							? { username: account.username, token: account.token }
							: undefined
					)
				};
			}
		});
	useTool({
		name: 'show_mods',
		description:
			'Show native mod cards to the user. Use this before recommending or comparing specific mods. Retrieves authoritative portal metadata and compatible releases; do not infer capabilities from names. Give each mod a short reason tied to this list.',
		input: v.object({
			mods: v.pipe(
				v.array(
					v.object({
						name: v.pipe(v.string(), v.maxLength(100)),
						reason: v.pipe(v.string(), v.maxLength(1000))
					})
				),
				v.minLength(1),
				v.maxLength(6)
			)
		}),
		async run({ data }) {
			const listId = await resolveList();
			const { list, mods } = await authorizedList(context.userId, listId);
			const activeMods = mods.filter((mod) => !mod.icebox);
			const candidates = new Map(
				recommendationCandidates(activeMods).map((candidate) => [candidate.name, candidate])
			);
			const results = await Promise.all(
				data.mods.map(async (item) => {
					const { data: info, warning } = await getPortalMod(item.name, true);
					if (warning)
						throw new Error(
							'Could not verify current mod releases while the Mod Portal is unavailable. Try again shortly.'
						);
					if (!info) throw new Error(`Mod not found: ${item.name}`);
					const candidate = candidates.get(info.name);
					const release = candidate
						? recommendationRelease(info.releases, candidate, activeMods, list.factorioVersion)
						: info.releases
								.filter((release) =>
									supportsFactorio(release.info_json.factorio_version, list.factorioVersion)
								)
								.sort((a, b) => compareVersions(b.version, a.version) ?? 0)[0];
					return {
						name: info.name,
						title: info.title,
						summary: info.summary ?? '',
						reason: item.reason,
						thumbnail: info.thumbnail ?? null,
						version: release?.version ?? null,
						factorioVersion: list.factorioVersion,
						enabled: mods.some((mod) => mod.name === info.name && mod.enabled && !mod.icebox)
					};
				})
			);
			return { output: { kind: 'mods', mods: results } };
		}
	});
	const changesInput = v.object({
		changes: v.pipe(
			v.array(
				v.object({
					name: v.pipe(v.string(), v.maxLength(100)),
					action: v.picklist([
						'enable',
						'disable',
						'remove',
						'icebox',
						'lock',
						'unlock',
						'set_version'
					]),
					version: v.optional(v.pipe(v.string(), v.maxLength(50)))
				})
			),
			v.minLength(1),
			v.maxLength(40)
		)
	});
	if (groups.has('changes')) {
		useTool({
			name: 'prepare_changes',
			description:
				'Preview a proposed set of mod changes when the user asks to review before applying. Supports enable, disable, remove, icebox, lock, unlock, and set_version to select an exact release. Pass every mod in the requested set in one call. Required dependencies are resolved once for the full set. This only creates a review.',
			input: changesInput,
			async run({ data }) {
				const listId = await resolveList();
				return {
					output: requestId
						? await prepareTurnModlistPlan(
								context.userId,
								listId,
								data,
								context.chatId ?? `${context.userId}-${listId}-chat`,
								requestId
							)
						: await prepareModlistPlan(
								context.userId,
								listId,
								data,
								context.chatId ?? `${context.userId}-${listId}-chat`
							)
				};
			}
		});
		useTool({
			name: 'apply_changes',
			description:
				'Apply the exact requested mod changes now. Use only when the user explicitly asks to add, enable, disable, remove, icebox, lock, unlock, select an exact release with set_version, or apply mods. set_version requires the exact version. Pass every requested mod in one call; dependencies are resolved and applied together. The operation checks permissions and a fresh list snapshot. Do not use for questions, recommendations, or hypothetical plans.',
			input: changesInput,
			async run({ data, toolCallId }) {
				const listId = await resolveList();
				const changes = [...data.changes].sort((a, b) => a.name.localeCompare(b.name));
				const key = createHash('sha256')
					.update(
						JSON.stringify([
							context.userId,
							listId,
							context.chatId,
							requestId ?? toolCallId,
							changes
						])
					)
					.digest('hex');
				return {
					output: await applyModlistChanges(
						context.userId,
						listId,
						data,
						context.chatId ?? `${context.userId}-${listId}-chat`,
						key,
						requestId
					)
				};
			}
		});
	}
}
