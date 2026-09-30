import { z } from 'zod';

const multiplier = z.number().finite().min(0).max(10);
const positiveMultiplier = z.number().finite().gt(0).max(10);
const fraction = z.number().finite().min(0).max(1);
const uint32 = z.number().int().min(0).max(0xffffffff);
const controlName = z
	.string()
	.min(1)
	.max(200)
	.refine((name) =>
		[...name].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
	);

const control = z.strictObject({
	frequency: multiplier.optional(),
	size: multiplier.optional(),
	richness: multiplier.optional()
});

// These are overrides. Missing values belong to the selected Factorio preset.
export const worldGenerationSchema = z.strictObject({
	preset: controlName.optional(),
	seed: uint32.optional(),
	width: uint32.max(2_000_000).optional(),
	height: uint32.max(2_000_000).optional(),
	startingArea: multiplier.optional(),
	peacefulMode: z.boolean().optional(),
	noEnemiesMode: z.boolean().optional(),
	resources: z.record(controlName, control).optional(),
	terrain: z
		.strictObject({
			mapType: z.enum(['normal', 'island']).optional(),
			waterScale: positiveMultiplier.optional(),
			waterCoverage: multiplier.optional(),
			treeScale: positiveMultiplier.optional(),
			treeCoverage: multiplier.optional(),
			cliffFrequency: multiplier.optional(),
			cliffContinuity: multiplier.optional(),
			moistureScale: positiveMultiplier.optional(),
			moistureBias: z.number().finite().min(-1).max(1).optional(),
			terrainScale: positiveMultiplier.optional(),
			terrainBias: z.number().finite().min(-1).max(1).optional()
		})
		.optional(),
	pollution: z
		.strictObject({
			enabled: z.boolean().optional(),
			diffusionRatio: fraction.optional(),
			ageing: multiplier.optional(),
			enemyAttackPollutionConsumptionModifier: multiplier.optional(),
			minPollutionToDamageTrees: z.number().finite().min(0).max(1_000_000).optional(),
			pollutionRestoredPerTreeDamage: z.number().finite().min(0).max(1_000_000).optional()
		})
		.optional(),
	evolution: z
		.strictObject({
			enabled: z.boolean().optional(),
			timeFactor: fraction.optional(),
			destroyFactor: fraction.optional(),
			pollutionFactor: fraction.optional()
		})
		.optional(),
	expansion: z
		.strictObject({
			enabled: z.boolean().optional(),
			minCooldown: uint32.optional(),
			maxCooldown: uint32.optional(),
			maxDistance: uint32.optional(),
			minGroupSize: uint32.optional(),
			maxGroupSize: uint32.optional()
		})
		.refine(
			({ minCooldown, maxCooldown }) =>
				minCooldown === undefined || maxCooldown === undefined || minCooldown <= maxCooldown,
			{ message: 'Minimum expansion cooldown must not exceed maximum' }
		)
		.refine(
			({ minGroupSize, maxGroupSize }) =>
				minGroupSize === undefined || maxGroupSize === undefined || minGroupSize <= maxGroupSize,
			{ message: 'Minimum expansion group size must not exceed maximum' }
		)
		.optional(),
	research: z
		.strictObject({ technologyPriceMultiplier: z.number().finite().gt(0).max(1000).optional() })
		.optional()
});

export type WorldGenerationSettings = z.infer<typeof worldGenerationSchema>;
export const defaultWorldGenerationSettings: WorldGenerationSettings = { preset: 'default' };

// Native JSON names follow data/map-gen-settings.example.json and data/map-settings.example.json.
export function toFactorioMapSettings(settings: WorldGenerationSettings) {
	const mapGenSettings: Record<string, unknown> = {};
	const mapSettings: Record<string, unknown> = {};
	if (settings.seed !== undefined) mapGenSettings.seed = settings.seed;
	if (settings.width !== undefined) mapGenSettings.width = settings.width;
	if (settings.height !== undefined) mapGenSettings.height = settings.height;
	if (settings.startingArea !== undefined) mapGenSettings.starting_area = settings.startingArea;
	if (settings.peacefulMode !== undefined) mapGenSettings.peaceful_mode = settings.peacefulMode;
	if (settings.noEnemiesMode !== undefined) mapGenSettings.no_enemies_mode = settings.noEnemiesMode;

	const controls: Record<string, Record<string, number>> = {};
	for (const [name, value] of Object.entries(settings.resources ?? {})) {
		const native: Record<string, number> = {};
		if (value.frequency !== undefined) native.frequency = value.frequency;
		if (value.size !== undefined) native.size = value.size;
		if (value.richness !== undefined) native.richness = value.richness;
		if (Object.keys(native).length)
			Object.defineProperty(controls, name, {
				value: native,
				enumerable: true,
				configurable: true
			});
	}
	const terrain = settings.terrain;
	if (terrain?.waterScale !== undefined || terrain?.waterCoverage !== undefined)
		controls.water = {
			...(terrain.waterScale !== undefined && { frequency: 1 / terrain.waterScale }),
			...(terrain.waterCoverage !== undefined && { size: terrain.waterCoverage })
		};
	if (terrain?.treeScale !== undefined || terrain?.treeCoverage !== undefined)
		controls.trees = {
			...(terrain.treeScale !== undefined && { frequency: 1 / terrain.treeScale }),
			...(terrain.treeCoverage !== undefined && { size: terrain.treeCoverage })
		};
	if (terrain?.cliffFrequency !== undefined || terrain?.cliffContinuity !== undefined)
		controls.nauvis_cliff = {
			...(terrain.cliffFrequency !== undefined && { frequency: terrain.cliffFrequency }),
			...(terrain.cliffContinuity !== undefined && { size: terrain.cliffContinuity })
		};
	if (Object.keys(controls).length) mapGenSettings.autoplace_controls = controls;
	const expressions: Record<string, string> = {};
	if (terrain?.mapType === 'island') expressions.elevation = 'elevation_island';
	if (terrain?.moistureScale !== undefined)
		expressions['control:moisture:frequency'] = String(1 / terrain.moistureScale);
	if (terrain?.moistureBias !== undefined)
		expressions['control:moisture:bias'] = String(terrain.moistureBias);
	if (terrain?.terrainScale !== undefined)
		expressions['control:aux:frequency'] = String(1 / terrain.terrainScale);
	if (terrain?.terrainBias !== undefined)
		expressions['control:aux:bias'] = String(terrain.terrainBias);
	if (Object.keys(expressions).length) mapGenSettings.property_expression_names = expressions;

	if (settings.pollution) {
		const {
			enabled,
			diffusionRatio,
			ageing,
			enemyAttackPollutionConsumptionModifier,
			minPollutionToDamageTrees,
			pollutionRestoredPerTreeDamage
		} = settings.pollution;
		mapSettings.pollution = {
			...(enabled !== undefined && { enabled }),
			...(diffusionRatio !== undefined && { diffusion_ratio: diffusionRatio }),
			...(ageing !== undefined && { ageing }),
			...(enemyAttackPollutionConsumptionModifier !== undefined && {
				enemy_attack_pollution_consumption_modifier: enemyAttackPollutionConsumptionModifier
			}),
			...(minPollutionToDamageTrees !== undefined && {
				min_pollution_to_damage_trees: minPollutionToDamageTrees
			}),
			...(pollutionRestoredPerTreeDamage !== undefined && {
				pollution_restored_per_tree_damage: pollutionRestoredPerTreeDamage
			})
		};
	}
	if (settings.evolution) {
		const { enabled, timeFactor, destroyFactor, pollutionFactor } = settings.evolution;
		mapSettings.enemy_evolution = {
			...(enabled !== undefined && { enabled }),
			...(timeFactor !== undefined && { time_factor: timeFactor }),
			...(destroyFactor !== undefined && { destroy_factor: destroyFactor }),
			...(pollutionFactor !== undefined && { pollution_factor: pollutionFactor })
		};
	}
	if (settings.expansion) {
		const { enabled, minCooldown, maxCooldown, maxDistance, minGroupSize, maxGroupSize } =
			settings.expansion;
		mapSettings.enemy_expansion = {
			...(enabled !== undefined && { enabled }),
			...(minCooldown !== undefined && { min_expansion_cooldown: minCooldown }),
			...(maxCooldown !== undefined && { max_expansion_cooldown: maxCooldown }),
			...(maxDistance !== undefined && { max_expansion_distance: maxDistance }),
			...(minGroupSize !== undefined && { settler_group_min_size: minGroupSize }),
			...(maxGroupSize !== undefined && { settler_group_max_size: maxGroupSize })
		};
	}
	if (settings.research?.technologyPriceMultiplier !== undefined)
		mapSettings.difficulty_settings = {
			technology_price_multiplier: settings.research.technologyPriceMultiplier
		};
	return { preset: settings.preset ?? 'default', mapGenSettings, mapSettings };
}

const mapGenSizes: Record<string, number> = {
	none: 0,
	'very-low': 0.5,
	'very-small': 0.5,
	'very-poor': 0.5,
	low: 1 / Math.SQRT2,
	small: 1 / Math.SQRT2,
	poor: 1 / Math.SQRT2,
	normal: 1,
	medium: 1,
	regular: 1,
	high: Math.SQRT2,
	big: Math.SQRT2,
	good: Math.SQRT2,
	'very-high': 2,
	'very-big': 2,
	'very-good': 2
};

function object(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function number(value: unknown): number | undefined {
	if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
	if (typeof value !== 'string') return undefined;
	if (Object.hasOwn(mapGenSizes, value)) return mapGenSizes[value];
	if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function assignNumber(
	target: Record<string, unknown>,
	key: string,
	value: unknown,
	schema: z.ZodType<number>
) {
	const parsed = number(value);
	if (parsed !== undefined && schema.safeParse(parsed).success) target[key] = parsed;
}

function assignBoolean(target: Record<string, unknown>, key: string, value: unknown) {
	if (typeof value === 'boolean') target[key] = value;
}

/** Read only fields exposed by the new-game form from native merged preset settings. */
export function fromFactorioMapSettings(
	mapGenSettings: Record<string, unknown>,
	mapSettings: Record<string, unknown>
): WorldGenerationSettings {
	const result: Record<string, unknown> = {};
	assignNumber(result, 'seed', mapGenSettings.seed, uint32);
	assignNumber(result, 'width', mapGenSettings.width, uint32.max(2_000_000));
	assignNumber(result, 'height', mapGenSettings.height, uint32.max(2_000_000));
	assignNumber(result, 'startingArea', mapGenSettings.starting_area, multiplier);
	assignBoolean(result, 'peacefulMode', mapGenSettings.peaceful_mode);
	assignBoolean(result, 'noEnemiesMode', mapGenSettings.no_enemies_mode);

	const controls = object(mapGenSettings.autoplace_controls);
	const resources: Record<string, unknown> = {};
	for (const [name, raw] of Object.entries(controls)) {
		if (
			name === 'water' ||
			name === 'trees' ||
			name === 'nauvis_cliff' ||
			!controlName.safeParse(name).success
		)
			continue;
		const native = object(raw);
		const values: Record<string, unknown> = {};
		assignNumber(values, 'frequency', native.frequency, multiplier);
		assignNumber(values, 'size', native.size, multiplier);
		assignNumber(values, 'richness', native.richness, multiplier);
		if (Object.keys(values).length)
			Object.defineProperty(resources, name, {
				value: values,
				enumerable: true,
				configurable: true
			});
	}
	if (Object.keys(resources).length) result.resources = resources;
	const terrain: Record<string, unknown> = {};
	const water = object(controls.water);
	const trees = object(controls.trees);
	const cliffs = object(controls.nauvis_cliff);
	const waterFrequency = number(water.frequency);
	const treeFrequency = number(trees.frequency);
	if (waterFrequency !== undefined && waterFrequency > 0)
		assignNumber(terrain, 'waterScale', 1 / waterFrequency, positiveMultiplier);
	assignNumber(terrain, 'waterCoverage', water.size, multiplier);
	if (treeFrequency !== undefined && treeFrequency > 0)
		assignNumber(terrain, 'treeScale', 1 / treeFrequency, positiveMultiplier);
	assignNumber(terrain, 'treeCoverage', trees.size, multiplier);
	assignNumber(terrain, 'cliffFrequency', cliffs.frequency, multiplier);
	assignNumber(terrain, 'cliffContinuity', cliffs.size, multiplier);
	const expressions = object(mapGenSettings.property_expression_names);
	if (expressions.elevation === 'elevation_island') terrain.mapType = 'island';
	const moistureFrequency = number(expressions['control:moisture:frequency']);
	const terrainFrequency = number(expressions['control:aux:frequency']);
	if (moistureFrequency !== undefined && moistureFrequency > 0)
		assignNumber(terrain, 'moistureScale', 1 / moistureFrequency, positiveMultiplier);
	assignNumber(
		terrain,
		'moistureBias',
		expressions['control:moisture:bias'],
		z.number().finite().min(-1).max(1)
	);
	if (terrainFrequency !== undefined && terrainFrequency > 0)
		assignNumber(terrain, 'terrainScale', 1 / terrainFrequency, positiveMultiplier);
	assignNumber(
		terrain,
		'terrainBias',
		expressions['control:aux:bias'],
		z.number().finite().min(-1).max(1)
	);
	if (Object.keys(terrain).length) result.terrain = terrain;

	const pollution = object(mapSettings.pollution);
	const pollutionValues: Record<string, unknown> = {};
	assignBoolean(pollutionValues, 'enabled', pollution.enabled);
	assignNumber(pollutionValues, 'diffusionRatio', pollution.diffusion_ratio, fraction);
	assignNumber(pollutionValues, 'ageing', pollution.ageing, multiplier);
	assignNumber(
		pollutionValues,
		'enemyAttackPollutionConsumptionModifier',
		pollution.enemy_attack_pollution_consumption_modifier,
		multiplier
	);
	assignNumber(
		pollutionValues,
		'minPollutionToDamageTrees',
		pollution.min_pollution_to_damage_trees,
		z.number().finite().min(0).max(1_000_000)
	);
	assignNumber(
		pollutionValues,
		'pollutionRestoredPerTreeDamage',
		pollution.pollution_restored_per_tree_damage,
		z.number().finite().min(0).max(1_000_000)
	);
	if (Object.keys(pollutionValues).length) result.pollution = pollutionValues;
	const evolution = object(mapSettings.enemy_evolution);
	const evolutionValues: Record<string, unknown> = {};
	assignBoolean(evolutionValues, 'enabled', evolution.enabled);
	assignNumber(evolutionValues, 'timeFactor', evolution.time_factor, fraction);
	assignNumber(evolutionValues, 'destroyFactor', evolution.destroy_factor, fraction);
	assignNumber(evolutionValues, 'pollutionFactor', evolution.pollution_factor, fraction);
	if (Object.keys(evolutionValues).length) result.evolution = evolutionValues;
	const expansion = object(mapSettings.enemy_expansion);
	const expansionValues: Record<string, unknown> = {};
	assignBoolean(expansionValues, 'enabled', expansion.enabled);
	assignNumber(expansionValues, 'minCooldown', expansion.min_expansion_cooldown, uint32);
	assignNumber(expansionValues, 'maxCooldown', expansion.max_expansion_cooldown, uint32);
	assignNumber(expansionValues, 'maxDistance', expansion.max_expansion_distance, uint32);
	assignNumber(expansionValues, 'minGroupSize', expansion.settler_group_min_size, uint32);
	assignNumber(expansionValues, 'maxGroupSize', expansion.settler_group_max_size, uint32);
	if (Object.keys(expansionValues).length) result.expansion = expansionValues;
	const difficulty = object(mapSettings.difficulty_settings);
	const research: Record<string, unknown> = {};
	assignNumber(
		research,
		'technologyPriceMultiplier',
		difficulty.technology_price_multiplier,
		z.number().finite().gt(0).max(1000)
	);
	if (Object.keys(research).length) result.research = research;
	return worldGenerationSchema.parse(result);
}
