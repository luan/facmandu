import * as v from 'valibot';

const plannerName = v.pipe(v.string(), v.minLength(1), v.maxLength(200));
const plannerRate = v.pipe(
	v.number(),
	v.finite(),
	v.minValue(Number.MIN_VALUE),
	v.maxValue(1000000)
);
const plannerTemperature = v.optional(v.pipe(v.number(), v.finite()));
const plannerProduct = {
	name: plannerName,
	type: v.picklist(['item', 'fluid']),
	temperature: plannerTemperature
};
const plannerPower = { name: plannerName, type: v.literal('entity') };
const plannerQuantity = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1000000));
const plannerWatts = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1e12));
const plannerModules = v.pipe(
	v.array(
		v.strictObject({
			name: plannerName,
			quality: v.optional(plannerName),
			count: v.pipe(plannerRate, v.integer())
		})
	),
	v.maxLength(32)
);
const plannerLineFields = {
	machine: v.optional(plannerName),
	quality: v.optional(plannerName),
	modules: v.optional(plannerModules),
	beacon: v.optional(
		v.union([
			v.literal(false),
			v.strictObject({
				name: plannerName,
				quality: v.optional(plannerName),
				count: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1000)),
				modules: v.optional(plannerModules)
			})
		])
	),
	fuel: v.optional(v.strictObject({ name: plannerName, temperature: plannerTemperature })),
	constraint: v.optional(
		v.union([
			v.literal(false),
			v.strictObject({ count: plannerQuantity, mode: v.picklist(['exact', 'maximum']) })
		])
	),
	temperatures: v.optional(
		v.pipe(
			v.record(plannerName, v.pipe(v.number(), v.finite())),
			v.check((value) => Object.keys(value).length <= 16, 'Choose up to 16 fluid temperatures')
		)
	),
	productionType: v.optional(v.picklist(['produce', 'consume'])),
	productionPercent: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1000))),
	powerMode: v.optional(v.picklist(['average', 'peak'])),
	neighborCount: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(4))),
	active: v.optional(v.boolean())
};
export const nativePlannerLinePatch = v.pipe(
	v.strictObject({
		recipe: v.optional(plannerName),
		...plannerLineFields,
		productionPercent: v.optional(
			v.union([v.literal(false), v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1000))])
		),
		powerMode: v.optional(v.union([v.literal(false), v.picklist(['average', 'peak'])])),
		neighborCount: v.optional(
			v.union([v.literal(false), v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(4))])
		)
	}),
	v.check((value) => Object.keys(value).length > 0, 'Choose at least one line edit')
);
export const nativePlannerProducts = v.pipe(
	v.array(
		v.union([
			v.pipe(
				v.strictObject({ ...plannerProduct, perMinute: plannerRate }),
				v.check(
					(value) => value.temperature === undefined || value.type === 'fluid',
					'Only fluids have temperatures'
				)
			),
			v.pipe(
				v.strictObject({ ...plannerProduct, machineCount: plannerRate }),
				v.check(
					(value) => value.temperature === undefined || value.type === 'fluid',
					'Only fluids have temperatures'
				)
			),
			v.strictObject({
				...plannerPower,
				watts: v.pipe(plannerWatts, v.minValue(Number.MIN_VALUE))
			})
		])
	),
	v.maxLength(8)
);
export const nativePlannerInputs = v.pipe(
	v.array(
		v.pipe(
			v.union([
				v.strictObject({
					...plannerProduct,
					perMinute: plannerQuantity,
					mode: v.picklist(['exact', 'maximum'])
				}),
				v.strictObject({
					name: plannerName,
					type: v.literal('item'),
					beltCount: plannerQuantity,
					belt: plannerName,
					beltStack: v.optional(v.pipe(plannerRate, v.integer())),
					mode: v.picklist(['exact', 'maximum'])
				}),
				v.strictObject({
					...plannerPower,
					watts: plannerWatts,
					mode: v.picklist(['exact', 'maximum'])
				})
			]),
			v.check(
				(value) =>
					!('temperature' in value) || value.temperature === undefined || value.type === 'fluid',
				'Only fluids have temperatures'
			)
		)
	),
	v.maxLength(32)
);
export const nativePlannerMaximize = v.pipe(
	v.strictObject({ ...plannerProduct, type: v.picklist(['item', 'fluid', 'entity']) }),
	v.check(
		(value) => value.temperature === undefined || value.type === 'fluid',
		'Only fluids have temperatures'
	)
);
const plannerRecipe = v.strictObject({ name: plannerName, ...plannerLineFields });
export const nativeFactoryPlanInput = v.strictObject({
	force: plannerName,
	player: plannerName,
	surface: plannerName,
	products: nativePlannerProducts,
	recipes: v.pipe(v.array(plannerRecipe), v.minLength(1), v.maxLength(24)),
	inputs: v.optional(nativePlannerInputs),
	maximize: v.optional(nativePlannerMaximize)
});

const scope = {
	force: nativeFactoryPlanInput.entries.force,
	player: nativeFactoryPlanInput.entries.player
};
const revision = v.pipe(
	v.number(),
	v.integer(),
	v.minValue(0),
	v.maxValue(Number.MAX_SAFE_INTEGER)
);
const lineId = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(Number.MAX_SAFE_INTEGER));
const reference = v.pipe(v.string(), v.regex(/^toby:\/\/plan\/[1-9]\d{0,9}\/[1-9]\d{0,9}$/u));
const blockProducts = v.pipe(
	v.array(
		v.pipe(
			v.union([
				v.strictObject({
					...plannerProduct,
					perMinute: plannerRate,
					mode: v.optional(v.picklist(['exact', 'maximum']))
				}),
				v.strictObject({
					...plannerPower,
					watts: v.pipe(plannerWatts, v.minValue(Number.MIN_VALUE)),
					mode: v.optional(v.picklist(['exact', 'maximum']))
				})
			]),
			v.check(
				(value) =>
					!('temperature' in value) || value.temperature === undefined || value.type === 'fluid',
				'Only fluids have temperatures'
			)
		)
	),
	v.maxLength(8)
);
export const savedFactoryPlanInput = v.variant('operation', [
	v.strictObject({
		operation: v.literal('create'),
		...nativeFactoryPlanInput.entries,
		name: scope.force
	}),
	v.strictObject({ operation: v.literal('list'), ...scope }),
	v.strictObject({ operation: v.literal('read'), ...scope, reference }),
	v.strictObject({
		operation: v.literal('set_inputs'),
		...scope,
		reference,
		expectedRevision: revision,
		inputs: nativePlannerInputs,
		maximize: v.optional(nativePlannerMaximize)
	}),
	v.strictObject({
		operation: v.literal('set_products'),
		...scope,
		reference,
		expectedRevision: revision,
		products: nativePlannerProducts
	}),
	v.strictObject({
		operation: v.literal('edit_line'),
		...scope,
		reference,
		expectedRevision: revision,
		lineId,
		patch: nativePlannerLinePatch
	}),
	v.strictObject({
		operation: v.literal('nest_line'),
		...scope,
		reference,
		expectedRevision: revision,
		lineId
	}),
	v.strictObject({
		operation: v.literal('edit_block'),
		...scope,
		reference,
		expectedRevision: revision,
		floorId: lineId,
		settings: v.union([
			v.literal(false),
			v.strictObject({
				linked: v.boolean(),
				mode: v.picklist(['output', 'input', 'machines']),
				products: blockProducts,
				inputs: nativePlannerInputs,
				maximize: v.optional(nativePlannerMaximize)
			})
		])
	}),
	v.strictObject({
		operation: v.literal('add_line'),
		...scope,
		reference,
		expectedRevision: revision,
		floorId: lineId,
		recipe: plannerRecipe
	}),
	v.strictObject({
		operation: v.literal('move_line'),
		...scope,
		reference,
		expectedRevision: revision,
		lineId,
		floorId: lineId,
		afterLineId: v.optional(lineId)
	}),
	v.strictObject({
		operation: v.literal('remove_line'),
		...scope,
		reference,
		expectedRevision: revision,
		lineId
	}),
	v.strictObject({
		operation: v.literal('set_solver'),
		...scope,
		reference,
		expectedRevision: revision,
		floorId: lineId,
		solver: v.picklist(['sequential', 'simplex', 'gaussian']),
		recursive: v.optional(v.boolean(), false)
	})
]);
