import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { db, userHasModlistAccess } from './db';
import { mod, modList, modListCollaborator } from './db/schema';
import { authorizedList } from './modlist-plans';

const PAGE_SIZE = 50;
const MAX_COMPARE_LISTS = 20;
const MAX_MOD_NAMES = 30;
const MAX_COMPARE_ROWS = 10_000;

type CompareInput = { listIds?: string[]; modNames?: string[]; offset?: number };

function pageOffset(offset: number | undefined) {
	if (offset === undefined) return 0;
	if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid page offset');
	return offset;
}

async function otherLists(userId: string, currentListId: string) {
	if (!(await userHasModlistAccess(userId, currentListId)))
		throw new Error('You no longer have access to this list');
	const rows = await db
		.select({
			id: modList.id,
			name: modList.name,
			factorioVersion: modList.factorioVersion,
			owner: modList.owner
		})
		.from(modList)
		.leftJoin(
			modListCollaborator,
			and(eq(modListCollaborator.modlistId, modList.id), eq(modListCollaborator.userId, userId))
		)
		.where(
			and(
				ne(modList.id, currentListId),
				or(eq(modList.owner, userId), eq(modListCollaborator.userId, userId))
			)
		)
		.orderBy(modList.name, modList.id);
	return rows.map(({ owner, ...list }) => ({
		...list,
		relationship: owner === userId ? ('owned' as const) : ('shared' as const),
		url: `/modlists/${list.id}`
	}));
}

export async function listAccessibleModlists(
	userId: string,
	currentListId: string,
	input: { offset?: number } = {}
) {
	const offset = pageOffset(input.offset);
	const lists = await otherLists(userId, currentListId);
	return {
		lists: lists.slice(offset, offset + PAGE_SIZE),
		total: lists.length,
		nextOffset: offset + PAGE_SIZE < lists.length ? offset + PAGE_SIZE : null
	};
}

export async function inspectAccessibleModlist(
	userId: string,
	currentListId: string,
	listId: string,
	input: { offset?: number } = {}
) {
	const offset = pageOffset(input.offset);
	const source = (await otherLists(userId, currentListId)).find((list) => list.id === listId);
	if (!source) throw new Error('List not found or not shared with you');
	const { mods } = await authorizedList(userId, listId);
	const sorted = mods
		.filter((item) => item.name !== 'base')
		.sort((a, b) => a.name.localeCompare(b.name));
	return {
		list: source,
		mods: sorted.slice(offset, offset + PAGE_SIZE).map((item) => ({
			name: item.name,
			title: item.title,
			version: item.version,
			enabled: Boolean(item.enabled && !item.icebox),
			icebox: Boolean(item.icebox),
			essential: Boolean(item.essential),
			autoDependency: item.autoDependency,
			summary: item.summary?.slice(0, 350) ?? null
		})),
		total: sorted.length,
		nextOffset: offset + PAGE_SIZE < sorted.length ? offset + PAGE_SIZE : null
	};
}

export async function compareAccessibleModlists(
	userId: string,
	currentListId: string,
	input: CompareInput = {}
) {
	const offset = pageOffset(input.offset);
	const available = await otherLists(userId, currentListId);
	const requested = input.listIds;
	if (requested && (requested.length < 1 || requested.length > MAX_COMPARE_LISTS))
		throw new Error(`Choose 1–${MAX_COMPARE_LISTS} other lists to compare`);
	if (input.modNames && (input.modNames.length < 1 || input.modNames.length > MAX_MOD_NAMES))
		throw new Error(`Choose 1–${MAX_MOD_NAMES} mod names to compare`);
	if (!requested && available.length > MAX_COMPARE_LISTS)
		return {
			selectionRequired: true as const,
			message: `You have ${available.length} other lists. Choose up to ${MAX_COMPARE_LISTS} list IDs from list_my_modlists.`,
			totalLists: available.length
		};
	const ids = requested ?? available.map((list) => list.id);
	const sources = available.filter((list) => ids.includes(list.id));
	if (sources.length !== new Set(ids).size)
		throw new Error('One or more lists are not owned by or shared with you');
	const names = input.modNames ? new Set(input.modNames) : null;
	const rows = ids.length
		? await db
				.select({
					listId: mod.modlist,
					name: mod.name,
					title: mod.title,
					version: mod.version,
					autoDependency: mod.autoDependency,
					essential: mod.essential
				})
				.from(mod)
				.innerJoin(modList, eq(modList.id, mod.modlist))
				.leftJoin(
					modListCollaborator,
					and(eq(modListCollaborator.modlistId, modList.id), eq(modListCollaborator.userId, userId))
				)
				.where(
					and(
						inArray(mod.modlist, ids),
						or(eq(modList.owner, userId), eq(modListCollaborator.userId, userId)),
						eq(mod.enabled, true),
						or(eq(mod.icebox, false), isNull(mod.icebox)),
						ne(mod.name, 'base'),
						input.modNames ? inArray(mod.name, input.modNames) : undefined
					)
				)
				.limit(MAX_COMPARE_ROWS + 1)
		: [];
	if (rows.length > MAX_COMPARE_ROWS)
		throw new Error('These lists contain too many enabled mods. Compare fewer lists at once.');
	const byId = new Map(sources.map((source) => [source.id, source]));
	const byName = new Map<
		string,
		{
			name: string;
			title: string | null;
			enabledCount: number;
			explicitCount: number;
			essentialCount: number;
			sources: {
				listId: string;
				listName: string;
				relationship: 'owned' | 'shared';
				factorioVersion: string;
				version: string | null;
				autoDependency: boolean;
				essential: boolean;
				url: string;
			}[];
		}
	>();
	for (const row of rows) {
		if (names && !names.has(row.name)) continue;
		const source = byId.get(row.listId);
		if (!source) continue;
		const entry = byName.get(row.name) ?? {
			name: row.name,
			title: row.title,
			enabledCount: 0,
			explicitCount: 0,
			essentialCount: 0,
			sources: []
		};
		entry.title ??= row.title;
		entry.enabledCount++;
		if (!row.autoDependency) entry.explicitCount++;
		if (row.essential) entry.essentialCount++;
		entry.sources.push({
			listId: source.id,
			listName: source.name,
			relationship: source.relationship,
			factorioVersion: source.factorioVersion,
			version: row.version,
			autoDependency: row.autoDependency,
			essential: Boolean(row.essential),
			url: source.url
		});
		byName.set(row.name, entry);
	}
	const matches = [...byName.values()].sort(
		(a, b) =>
			b.explicitCount - a.explicitCount ||
			b.enabledCount - a.enabledCount ||
			a.name.localeCompare(b.name)
	);
	for (const match of matches)
		match.sources.sort(
			(a, b) => a.listName.localeCompare(b.listName) || a.listId.localeCompare(b.listId)
		);
	return {
		selectionRequired: false as const,
		lists: sources,
		mods: matches.slice(offset, offset + PAGE_SIZE),
		totalMods: matches.length,
		nextOffset: offset + PAGE_SIZE < matches.length ? offset + PAGE_SIZE : null,
		note: 'Enabled across lists is evidence of reuse, not proof the owner prefers or requires a mod. Auto dependencies are counted separately; disabled and icebox mods are excluded.'
	};
}
