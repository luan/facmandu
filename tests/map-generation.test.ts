import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	defaultWorldGenerationSettings,
	fromFactorioMapSettings,
	toFactorioMapSettings,
	worldGenerationSchema
} from '../src/lib/map-generation';

describe('world generation settings', () => {
	test('preserves selected preset defaults when no overrides are supplied', () => {
		assert.deepEqual(toFactorioMapSettings(defaultWorldGenerationSettings), {
			preset: 'default',
			mapGenSettings: {},
			mapSettings: {}
		});
	});

	test('maps generation, enemy and research overrides to native JSON', () => {
		const settings = worldGenerationSchema.parse({
			preset: 'rail-world',
			seed: 0,
			width: 0,
			height: 256,
			startingArea: 2,
			peacefulMode: true,
			noEnemiesMode: false,
			resources: {
				'iron-ore': { frequency: 0.5, size: 2, richness: 3 },
				'modded.ore with space': { size: 2 }
			},
			terrain: {
				mapType: 'island',
				waterScale: 2,
				waterCoverage: 0.5,
				treeScale: 0.5,
				treeCoverage: 1.5,
				cliffFrequency: 2,
				cliffContinuity: 0,
				moistureScale: 2,
				moistureBias: -0.5,
				terrainScale: 4,
				terrainBias: 0.2
			},
			pollution: {
				enabled: false,
				diffusionRatio: 0.02,
				ageing: 2,
				enemyAttackPollutionConsumptionModifier: 0,
				minPollutionToDamageTrees: 60,
				pollutionRestoredPerTreeDamage: 10
			},
			evolution: {
				enabled: false,
				timeFactor: 0.000004,
				destroyFactor: 0.002,
				pollutionFactor: 0.0000009
			},
			expansion: {
				enabled: false,
				minCooldown: 14400,
				maxCooldown: 216000,
				maxDistance: 5,
				minGroupSize: 5,
				maxGroupSize: 10
			},
			research: { technologyPriceMultiplier: 4 }
		});
		assert.deepEqual(toFactorioMapSettings(settings), {
			preset: 'rail-world',
			mapGenSettings: {
				seed: 0,
				width: 0,
				height: 256,
				starting_area: 2,
				peaceful_mode: true,
				no_enemies_mode: false,
				autoplace_controls: {
					'iron-ore': { frequency: 0.5, size: 2, richness: 3 },
					'modded.ore with space': { size: 2 },
					water: { frequency: 0.5, size: 0.5 },
					trees: { frequency: 2, size: 1.5 },
					nauvis_cliff: { frequency: 2, size: 0 }
				},
				property_expression_names: {
					elevation: 'elevation_island',
					'control:moisture:frequency': '0.5',
					'control:moisture:bias': '-0.5',
					'control:aux:frequency': '0.25',
					'control:aux:bias': '0.2'
				}
			},
			mapSettings: {
				pollution: {
					enabled: false,
					diffusion_ratio: 0.02,
					ageing: 2,
					enemy_attack_pollution_consumption_modifier: 0,
					min_pollution_to_damage_trees: 60,
					pollution_restored_per_tree_damage: 10
				},
				enemy_evolution: {
					enabled: false,
					time_factor: 0.000004,
					destroy_factor: 0.002,
					pollution_factor: 0.0000009
				},
				enemy_expansion: {
					enabled: false,
					min_expansion_cooldown: 14400,
					max_expansion_cooldown: 216000,
					max_expansion_distance: 5,
					settler_group_min_size: 5,
					settler_group_max_size: 10
				},
				difficulty_settings: { technology_price_multiplier: 4 }
			}
		});
	});

	test('rejects invalid values and arbitrary native keys', () => {
		for (const input of [
			{ seed: -1 },
			{ seed: 2 ** 32 },
			{ seed: 1.5 },
			{ width: 2_000_001 },
			{ height: -1 },
			{ resources: { 'bad\nname': { frequency: 1 } } },
			{ resources: { 'iron-ore': { frequency: Infinity } } },
			{ terrain: { waterScale: 0 } },
			{ evolution: { timeFactor: -1 } },
			{ pollution: { diffusionRatio: 2 } },
			{ expansion: { minCooldown: 2, maxCooldown: 1 } },
			{ expansion: { minGroupSize: 11, maxGroupSize: 10 } },
			{ research: { technologyPriceMultiplier: 0 } },
			{ path: '/tmp/settings.json' }
		])
			assert.equal(worldGenerationSchema.safeParse(input).success, false);
	});

	test('reads recognized native settings and converts preset size names', () => {
		const native = toFactorioMapSettings(
			worldGenerationSchema.parse({
				seed: 42,
				width: 0,
				height: 1000,
				resources: { 'modded.ore with space': { frequency: 0.5, size: 2, richness: 3 } },
				terrain: {
					mapType: 'island',
					waterScale: 2,
					waterCoverage: 1.5,
					treeScale: 0.5,
					treeCoverage: 2,
					cliffFrequency: 0,
					cliffContinuity: 1,
					moistureScale: 2,
					moistureBias: -0.2,
					terrainScale: 4,
					terrainBias: 0.3
				},
				peacefulMode: true,
				noEnemiesMode: false,
				pollution: { enabled: true, ageing: 0.5 },
				evolution: { enabled: true, timeFactor: 0.00002 },
				expansion: {
					enabled: false,
					minCooldown: 14400,
					maxCooldown: 216000,
					maxDistance: 5,
					minGroupSize: 5,
					maxGroupSize: 10
				},
				research: { technologyPriceMultiplier: 4 }
			})
		);
		const actual = fromFactorioMapSettings(native.mapGenSettings, native.mapSettings);
		assert.deepEqual(actual, {
			seed: 42,
			width: 0,
			height: 1000,
			peacefulMode: true,
			noEnemiesMode: false,
			resources: { 'modded.ore with space': { frequency: 0.5, size: 2, richness: 3 } },
			terrain: {
				mapType: 'island',
				waterScale: 2,
				waterCoverage: 1.5,
				treeScale: 0.5,
				treeCoverage: 2,
				cliffFrequency: 0,
				cliffContinuity: 1,
				moistureScale: 2,
				moistureBias: -0.2,
				terrainScale: 4,
				terrainBias: 0.3
			},
			pollution: { enabled: true, ageing: 0.5 },
			evolution: { enabled: true, timeFactor: 0.00002 },
			expansion: {
				enabled: false,
				minCooldown: 14400,
				maxCooldown: 216000,
				maxDistance: 5,
				minGroupSize: 5,
				maxGroupSize: 10
			},
			research: { technologyPriceMultiplier: 4 }
		});
		assert.deepEqual(
			fromFactorioMapSettings(
				{
					autoplace_controls: {
						'iron-ore': { frequency: 'very-low', size: 'very-big', richness: 'very-good' },
						water: { frequency: 'low', size: 'normal' }
					}
				},
				{}
			),
			{
				resources: { 'iron-ore': { frequency: 0.5, size: 2, richness: 2 } },
				terrain: { waterScale: Math.SQRT2, waterCoverage: 1 }
			}
		);
		assert.deepEqual(
			fromFactorioMapSettings(
				{
					seed: -1,
					width: 2_000_001,
					autoplace_controls: {
						'iron-ore': { frequency: 'not-a-size', richness: 2 },
						water: { frequency: 0 }
					},
					property_expression_names: {
						elevation: 'modded-elevation',
						'control:moisture:bias': '1+1'
					},
					unknown_future_setting: { value: 1 }
				},
				{ pollution: { enabled: 'yes', ageing: 2 }, unknown_future_setting: 4 }
			),
			{
				resources: { 'iron-ore': { richness: 2 } },
				pollution: { ageing: 2 }
			}
		);
	});
});
