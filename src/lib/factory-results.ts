import type { FactoryResult } from './assistant-results';

type Data = Record<string, unknown>;
export type ResultMetric = { label: string; value: string; fraction?: number };
export type PrototypeRef = {
	kind: 'technology' | 'item' | 'fluid' | 'recipe' | 'entity';
	name: string;
};
export type ResultDetail = { label: string; entries: { text: string; prototype?: PrototypeRef }[] };
export type ResultCard = {
	title: string;
	prototype?: PrototypeRef;
	subtitle?: string;
	badge?: string;
	tone?: 'good' | 'muted' | 'warning';
	metrics: ResultMetric[];
	notes: string[];
	details?: ResultDetail[];
	gps?: string;
};
export type ResultTable = {
	title: string;
	columns: string[];
	rows: string[][];
	prototypes?: (PrototypeRef | undefined)[][];
};
export type ResultView = {
	title: string;
	icon: 'research' | 'players' | 'production' | 'location' | 'server';
	context: string;
	cards: ResultCard[];
	tables: ResultTable[];
	notes: string[];
	assumptions: string[];
	lines: string[];
	empty: string;
	link?: { href: string; label: string };
};
const record = (value: unknown): Data =>
	value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Data) : {};
const rows = (value: unknown): Data[] => (Array.isArray(value) ? value.map(record) : []);
const string = (value: unknown) => (typeof value === 'string' ? value : '');
const prototype = (kind: PrototypeRef['kind'], name: unknown): PrototypeRef | undefined =>
	string(name) ? { kind, name: string(name) } : undefined;
export const resultNumber = (value: unknown): number | undefined =>
	(typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) &&
	Number.isFinite(Number(value))
		? Number(value)
		: undefined;
export const humanName = (value: unknown) =>
	string(value)
		.replaceAll(/[_-]/gu, ' ')
		.replace(/^\w/u, (c) => c.toUpperCase());
const formatted = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
const display = (value: unknown) => {
	const number = resultNumber(value);
	return number === undefined ? string(value) : formatted(number);
};
const rate = (value: unknown) => {
	const number = resultNumber(value);
	return number === undefined ? '—' : `${formatted(number)}/min`;
};
const numeric = (label: string, value: unknown, unit = ''): ResultMetric[] => {
	const n = resultNumber(value);
	return n === undefined ? [] : [{ label, value: `${formatted(n)}${unit}` }];
};
const percent = (label: string, value: unknown): ResultMetric[] => {
	const n = resultNumber(value);
	return n === undefined
		? []
		: [{ label, value: `${formatted(n * 100)}%`, fraction: Math.max(0, Math.min(1, n)) }];
};
const listNames = (value: unknown) =>
	Array.isArray(value) ? value.map(humanName).filter(Boolean) : [];
const titles: Record<string, string> = {
	list_forces: 'Forces',
	list_players: 'Players',
	available_research: 'Available research',
	current_research: 'Current research',
	research_queue: 'Research queue',
	tech_status: 'Technology',
	item_rate: 'Item production',
	fluid_rate: 'Fluid production',
	top_items: 'Top production',
	production_since: 'Production totals',
	list_surfaces: 'Surfaces',
	find_entities: 'Entity locations',
	locate_player: 'Player locations',
	entity_count: 'Entity counts',
	built: 'Construction',
	kills: 'Kills',
	losses: 'Losses',
	logistic_robots_total: 'Logistic robots',
	rockets: 'Rocket launches',
	trains: 'Trains',
	logistics_summary: 'Logistic networks',
	evolution: 'Evolution',
	pollution: 'Pollution',
	game_time: 'Game time',
	sweep: 'Factory comparison',
	server_status: 'Server',
	server_mods: 'Installed mods',
	server_logs: 'Recent logs'
};
const labels: Record<string, string> = {
	produced_per_min: 'Produced / min',
	consumed_per_min: 'Consumed / min',
	net_per_min: 'Net / min',
	produced: 'Produced',
	consumed: 'Consumed',
	net: 'Net',
	count: 'Count',
	built: 'Built',
	mined: 'Mined',
	killed: 'Killed',
	kills: 'Kills',
	losses: 'Losses',
	logistic_robots_total: 'Logistic robots',
	launched: 'Launched',
	rockets_launched: 'Rockets launched',
	trains: 'Trains',
	moving: 'Moving',
	manual: 'Manual',
	cells: 'Roboports',
	logistic_robots: 'Logistic robots',
	logistic_robots_available: 'Available logistic robots',
	construction_robots: 'Construction robots',
	construction_robots_available: 'Available construction robots',
	total_pollution: 'Total pollution',
	force_players: 'Players',
	hours: 'Map age',
	connected_players: 'Players online',
	force_connected_players: 'Force online',
	distance: 'Distance',
	distinct_items: 'Item types'
};
function metrics(data: Data) {
	return Object.entries(labels).flatMap(([key, label]) =>
		numeric(label, data[key], key === 'hours' ? ' h' : key === 'distance' ? ' tiles' : '')
	);
}
function context(data: Data) {
	return [
		data.force ? `Force: ${data.force}` : '',
		data.surface ? `Surface: ${data.surface}` : '',
		data.window ? `${humanName(data.window)} window` : '',
		data.all_qualities ? 'All qualities' : ''
	]
		.filter(Boolean)
		.join(' · ');
}
function limits(data: Data) {
	const notes: string[] = [];
	const total = resultNumber(data.total ?? data.queued ?? data.prerequisites_total);
	const shown = resultNumber(data.shown ?? data.prerequisites_shown);
	if (total !== undefined && shown !== undefined && shown < total)
		notes.push(`Showing ${formatted(shown)} of ${formatted(total)} results.`);
	if (data.truncated === true) notes.push('Scan limit reached; additional matches may exist.');
	if (data.partial === true) notes.push('Only the recent portion of the log was searched.');
	if (resultNumber(data.skipped))
		notes.push(`${formatted(Number(data.skipped))} entries could not be read.`);
	if (data.covers_full_period === false)
		notes.push('Available samples do not cover the full requested period.');
	if (data.method === 'flow samples') notes.push('Estimated from production samples.');
	if (data.why === 'bytes') notes.push('Result size limit reached.');
	return notes;
}
function research(data: Data, tool: string): ResultCard {
	const inactive = data.researching === false;
	const title = humanName(data.tech ?? data.name) || (inactive ? 'No active research' : 'Research');
	const badge =
		data.researched === true
			? 'Researched'
			: data.enabled === false
				? 'Disabled'
				: tool === 'available_research'
					? 'Available'
					: data.available === false
						? 'Blocked'
						: data.researching === true || (tool === 'current_research' && !inactive)
							? 'Researching'
							: tool === 'research_queue'
								? `#${data.position ?? ''}`
								: data.available === true
									? 'Available'
									: undefined;
	const notes = [...limits(data)];
	const details: ResultDetail[] = [];
	const ingredients = rows(data.ingredients)
		.filter((item) => string(item.name))
		.map((item) => ({
			text: `${formatted(resultNumber(item.amount) ?? 1)} × ${humanName(item.name)}`,
			prototype: prototype('item', item.name)
		}));
	if (ingredients.length) details.push({ label: 'Per research unit', entries: ingredients });
	const trigger = record(data.trigger);

	if (trigger.type) {
		const target = trigger.item ?? trigger.entity ?? trigger.fluid;
		const targetName = typeof target === 'string' ? target : record(target).name;
		const name = humanName(targetName);
		const verbs: Record<string, string> = {
			'craft-item': 'Craft',
			'craft-fluid': 'Produce',
			'mine-entity': 'Mine',
			'build-entity': 'Build',
			'send-item-to-orbit': 'Send to orbit',
			'capture-spawner': 'Capture',
			'create-space-platform': 'Create a space platform',
			scripted: 'Complete the scripted research objective'
		};
		const triggerText = [
			(trigger.count ?? trigger.amount)
				? `${formatted(Number(trigger.count ?? trigger.amount))} ×`
				: '',
			name
		]
			.filter(Boolean)
			.join(' ');
		const triggerKind = trigger.fluid ? 'fluid' : trigger.entity ? 'entity' : 'item';
		details.push({
			label: verbs[string(trigger.type)] ?? humanName(trigger.type),
			entries: triggerText
				? [{ text: triggerText, prototype: prototype(triggerKind, targetName) }]
				: []
		});
	}

	const unlocks = Array.isArray(data.unlocks)
		? data.unlocks.filter((name): name is string => typeof name === 'string' && !!name)
		: [];
	if (unlocks.length)
		details.push({
			label: 'Unlocks',
			entries: unlocks.map((name) => ({
				text: humanName(name),
				prototype: prototype('recipe', name)
			}))
		});
	if (Number(data.unlocks_total) > unlocks.length) {
		const remaining = Number(data.unlocks_total) - unlocks.length;
		notes.push(`${remaining} more recipe ${remaining === 1 ? 'unlock' : 'unlocks'}`);
	}
	const prerequisites = rows(data.prerequisites).filter((row) => string(row.name));
	if (prerequisites.length)
		details.push({
			label: 'Prerequisites',
			entries: prerequisites.map((row) => ({
				text: `${humanName(row.name)}${row.researched ? ' · Completed' : ''}`,
				prototype: prototype('technology', row.name)
			}))
		});
	return {
		title,
		prototype: prototype('technology', data.tech ?? data.name),
		subtitle: [string(data.force), Number(data.level) > 1 ? `Level ${data.level}` : '']
			.filter(Boolean)
			.join(' · '),
		badge,
		tone:
			badge === 'Researched' || badge === 'Available'
				? 'good'
				: badge === 'Blocked'
					? 'warning'
					: 'muted',
		metrics: [
			...(data.trigger ? [] : numeric('Research units', data.units)),
			...percent('Progress', data.progress)
		],
		notes,
		details
	};
}
function detailCard(data: Data, title: string, ref?: PrototypeRef): ResultCard {
	return {
		title,
		prototype: ref,
		subtitle: [
			data.platform ? `Platform: ${data.platform}` : '',
			string(data.surface),
			string(data.force),
			data.planet ? humanName(data.planet) : '',
			data.recipe ? `Recipe: ${humanName(data.recipe)}` : '',
			data.location ? `At ${humanName(data.location)}` : '',
			data.owner ? `Owner: ${data.owner}` : ''
		]
			.filter(Boolean)
			.join(' · '),
		badge: data.ghost
			? 'Ghost'
			: typeof data.connected === 'boolean'
				? data.connected
					? 'Online'
					: 'Offline'
				: string(data.state) || undefined,
		tone: data.connected === true ? 'good' : 'muted',
		metrics: metrics(data),
		notes: [
			...limits(data),
			...rows(data.contents).map(
				(item) =>
					`${humanName(item.name)}${item.quality ? ` (${humanName(item.quality)})` : ''}: ${formatted(resultNumber(item.count) ?? 0)}`
			)
		],
		gps: string(data.gps) || undefined
	};
}
function planView(view: ResultView, data: Data) {
	view.title = 'Production plan';
	const target = record(data.target);
	view.context = [
		string(data.force),
		string(data.surface),
		data.window === 'one_minute' ? '1 minute' : humanName(data.window)
	]
		.filter(Boolean)
		.join(' · ');
	view.cards.push({
		title: humanName(target.name) || 'Target',
		prototype:
			target.type === 'fluid' ? prototype('fluid', target.name) : prototype('item', target.name),
		subtitle: string(target.type),
		badge:
			data.status === 'complete'
				? 'Planned'
				: data.status === 'needs_choices'
					? 'Choose recipes'
					: 'Limited',
		tone: data.status === 'complete' ? 'good' : 'warning',
		metrics: numeric('Target / min', target.per_min),
		notes: []
	});
	const measured = record(data.measured);
	if (Object.keys(measured).length) {
		view.cards.push({
			title: 'Current production',
			metrics: [
				...numeric('Produced / min', measured.produced_per_min),
				...numeric('Consumed / min', measured.consumed_per_min),
				...numeric('Net / min', measured.net_per_min),
				...numeric('Gap / min', measured.gap_per_min)
			],
			notes: []
		});
	}
	const steps = rows(data.steps);
	if (steps.length)
		view.tables.push({
			title: 'Build steps',
			columns: ['Recipe', 'Crafts / min', 'Machines'],
			rows: steps.map((step) => [
				humanName(step.recipe),
				rate(step.crafts_per_min),
				[display(step.machines), humanName(step.machine)].filter(Boolean).join(' × ') || '—'
			]),
			prototypes: steps.map((step) => [
				prototype('recipe', step.recipe),
				undefined,
				prototype('entity', step.machine)
			])
		});
	const inputs = rows(data.inputs);
	if (inputs.length)
		view.tables.push({
			title: 'Required inputs',
			columns: ['Ingredient', 'Rate'],
			rows: inputs.map((input) => [humanName(input.name), rate(input.per_min)]),
			prototypes: inputs.map((input) => [
				prototype(input.type === 'fluid' ? 'fluid' : 'item', input.name),
				undefined
			])
		});
	const outputs = rows(data.outputs);
	if (outputs.length)
		view.tables.push({
			title: 'Outputs',
			columns: ['Product', 'Rate'],
			rows: outputs.map((output) => [humanName(output.name), rate(output.per_min)]),
			prototypes: outputs.map((output) => [
				prototype(output.type === 'fluid' ? 'fluid' : 'item', output.name),
				undefined
			])
		});
	const choices = rows(data.choices);
	for (const choice of choices)
		view.cards.push({
			title: humanName(choice.product),
			prototype: prototype(choice.type === 'fluid' ? 'fluid' : 'item', choice.product),
			badge: 'Choose recipe',
			tone: 'warning',
			metrics: [],
			notes: [],
			details: [
				{
					label: 'Recipes',
					entries: rows(choice.recipes).map((recipe) => ({
						text: `${humanName(recipe.name)}${recipe.enabled === false ? ' (disabled)' : ''}`,
						prototype: prototype('recipe', recipe.name)
					}))
				}
			]
		});
	for (const choice of rows(data.machine_choices))
		view.cards.push({
			title: humanName(choice.recipe),
			prototype: prototype('recipe', choice.recipe),
			badge: 'Choose machine',
			tone: 'warning',
			metrics: [],
			notes: [],
			details: [
				{
					label: 'Machines',
					entries: rows(choice.machines).map((machine) => ({
						text: `${humanName(machine.name)} · speed ${display(machine.speed)}`,
						prototype: prototype('entity', machine.name)
					}))
				}
			]
		});
	view.assumptions = Array.isArray(data.assumptions)
		? data.assumptions.filter((assumption): assumption is string => typeof assumption === 'string')
		: [];
	view.notes.push(
		...(Array.isArray(data.issues)
			? data.issues.filter((issue): issue is string => typeof issue === 'string')
			: [])
	);
	view.empty = 'No plan steps available.';
}
function actionView(view: ResultView, tool: string, data: Data) {
	const before = record(data.before);
	const after = record(data.after);
	const operation = string(data.operation) || tool;
	const inspected = operation.endsWith('_inspect');
	view.title = operation.startsWith('research_')
		? 'Research queue'
		: operation.startsWith('train_')
			? 'Train'
			: 'Logistic request';
	view.icon = operation.startsWith('research_') ? 'research' : 'production';
	view.context = [string(after.force ?? before.force), string(after.surface ?? before.surface)]
		.filter(Boolean)
		.join(' · ');
	if (operation.startsWith('research_')) {
		const queue = listNames(after.queue);
		if (inspected && !queue.length) {
			view.empty = 'No research queued.';
			return;
		}
		view.cards = [
			{
				title: humanName(after.researching) || queue[0] || 'No active research',
				prototype: prototype(
					'technology',
					after.researching ?? (Array.isArray(after.queue) ? after.queue[0] : undefined)
				),
				badge: inspected ? undefined : queue.length ? 'Updated' : 'Cleared',
				tone: inspected ? 'muted' : 'good',
				metrics: percent('Progress', after.progress),
				notes: [],
				details: [
					...(inspected
						? []
						: [
								{
									label: 'Before',
									entries: (Array.isArray(before.queue) ? before.queue : []).map((name) => ({
										text: humanName(name),
										prototype: prototype('technology', name)
									}))
								}
							]),
					{
						label: inspected ? 'Order' : 'Now',
						entries: (Array.isArray(after.queue) ? after.queue : []).map((name) => ({
							text: humanName(name),
							prototype: prototype('technology', name)
						}))
					}
				]
			}
		];
	} else if (operation.startsWith('train_')) {
		const stations = listNames(after.stations);
		view.cards = [
			{
				title: `Train ${display(after.trainId ?? before.trainId)}`,
				badge:
					after.manual === true
						? 'Manual'
						: after.manual === false
							? 'Automatic'
							: inspected
								? undefined
								: 'Updated',
				tone: inspected ? 'muted' : 'good',
				metrics: [],
				notes: []
			}
		];
		if (stations.length)
			view.tables.push({
				title: 'Schedule',
				columns: ['#', 'Station', ''],
				rows: stations.map((station, index) => [
					String(index + 1),
					station,
					index + 1 === after.currentIndex ? 'Current' : ''
				])
			});
	} else {
		const request = record(after.request);
		const previous = record(before.request);
		const requester = display(after.unitNumber ?? before.unitNumber);
		const location = record(after.position ?? before.position);
		view.cards = [
			{
				title: humanName(request.item ?? previous.item) || 'Logistic request',
				badge: inspected ? undefined : Object.keys(request).length ? 'Set' : 'Cleared',
				tone: inspected ? 'muted' : 'good',
				metrics: numeric('Requested', request.count),
				notes: [
					`Requester ${requester}`,
					`Section ${display(after.sectionIndex ?? before.sectionIndex)}, slot ${display(after.slotIndex ?? before.slotIndex)}`,
					request.quality ? `Quality: ${humanName(request.quality)}` : '',
					inspected
						? ''
						: `Before: ${display(previous.count) || 'none'} · Now: ${display(request.count) || 'none'}`
				].filter(Boolean),
				gps:
					typeof location.x === 'number' && typeof location.y === 'number'
						? `[gps=${location.x},${location.y},${string(after.surface ?? before.surface)}]`
						: undefined
			}
		];
	}
}
function inventory(view: ResultView, title: string, value: unknown) {
	const data = record(value);
	const items = rows(data.items);
	if (items.length)
		view.tables.push({
			title,
			columns: ['Item', 'Count'],
			rows: items.map((item) => [
				[humanName(item.name), item.quality ? `(${humanName(item.quality)})` : '']
					.filter(Boolean)
					.join(' '),
				display(item.count)
			]),
			prototypes: items.map((item) => [prototype('item', item.name), undefined])
		});
	const fluids = rows(data.fluids);
	if (fluids.length)
		view.tables.push({
			title,
			columns: ['Fluid', 'Amount'],
			rows: fluids.map((fluid) => [humanName(fluid.name), display(fluid.amount)]),
			prototypes: fluids.map((fluid) => [prototype('fluid', fluid.name), undefined])
		});
}
function diagnosticView(view: ResultView, tool: string, data: Data) {
	view.icon = tool === 'inspect_train' || tool === 'inspect_train_stop' ? 'location' : 'production';
	const title =
		humanName(data.name) ||
		humanName(data.station) ||
		(data.train_id ? `Train ${data.train_id}` : view.title);
	const notes = [
		data.recipe ? `Recipe: ${humanName(record(data.recipe).name)}` : '',
		data.destination ? `Destination: ${humanName(data.destination)}` : '',
		data.station ? `Station: ${humanName(data.station)}` : '',
		data.connected_to_power_source === false ? 'Not connected to power' : '',
		data.has_path === false ? 'No path' : '',
		data.supports_requests === false ? 'This entity does not support logistic requests' : ''
	].filter(Boolean);
	const consumption = record(data.consumption);
	const generation = record(data.generation);
	const metrics = [
		...numeric('Crafting speed', data.crafting_speed),
		...percent('Craft progress', data.crafting_progress),
		...numeric('Energy', data.energy_j, ' J'),
		...numeric('Speed', data.speed),
		...numeric('Trains', data.trains_count),
		...numeric('Train limit', data.trains_limit),
		...numeric('Priority', data.priority),
		...numeric('Nearby accumulators', data.nearby_accumulators),
		...numeric('Stored', data.nearby_accumulator_stored_j, ' J'),
		...numeric('Capacity', data.nearby_accumulator_capacity_j, ' J'),
		...numeric('Disconnected nearby', data.disconnected_nearby_total),
		...numeric('Consumption', consumption.total_watts, ' W'),
		...numeric('Generation', generation.total_watts, ' W'),
		...numeric('Stopped train ID', data.stopped_train_id)
	];
	view.cards = [
		{
			title,
			prototype: prototype('entity', data.name),
			subtitle: [string(data.type), string(data.surface), string(data.force)]
				.filter(Boolean)
				.join(' · '),
			badge:
				data.manual === true
					? 'Manual'
					: data.manual === false
						? 'Automatic'
						: string(data.status || data.state) || undefined,
			tone:
				data.connected_to_power_source === false || data.has_path === false ? 'warning' : 'muted',
			metrics,
			notes,
			gps:
				typeof data.x === 'number' && typeof data.y === 'number'
					? `[gps=${data.x},${data.y},${string(data.surface)}]`
					: undefined
		}
	];
	for (const key of ['input', 'output', 'modules', 'cargo', 'fluids'])
		inventory(view, humanName(key), data[key]);
	for (const key of ['consumption', 'generation']) {
		const flow = record(data[key]);
		const entities = rows(flow.entities);
		if (entities.length)
			view.tables.push({
				title: `${humanName(key)} · ${display(flow.total_watts)} W`,
				columns: ['Entity', 'Power'],
				rows: entities.map((entity) => [humanName(entity.name), `${display(entity.watts)} W`]),
				prototypes: entities.map((entity) => [prototype('entity', entity.name), undefined])
			});
	}
	const disconnected = rows(data.disconnected_nearby);
	if (disconnected.length)
		view.tables.push({
			title: 'Disconnected nearby',
			columns: ['Entity', 'Location'],
			rows: disconnected.map((entity) => [
				humanName(entity.name),
				`${display(entity.x)}, ${display(entity.y)}`
			]),
			prototypes: disconnected.map((entity) => [prototype('entity', entity.name), undefined])
		});
	const sections = rows(data.sections);
	for (const section of sections) {
		const filters = rows(section.filters);
		view.tables.push({
			title: `Section ${display(section.index)}${section.group ? ` · ${humanName(section.group)}` : ''}${section.active === false ? ' · Inactive' : ''}`,
			columns: ['Item', 'Quality', 'Minimum', 'Maximum'],
			rows: filters.map((filter) => [
				humanName(filter.name),
				humanName(filter.quality),
				display(filter.min),
				display(filter.max)
			]),
			prototypes: filters.map((filter) => [
				prototype('item', filter.name),
				undefined,
				undefined,
				undefined
			])
		});
	}
	const schedule = record(data.schedule);
	const records = rows(schedule.records);
	if (records.length)
		view.tables.push({
			title: 'Schedule',
			columns: ['Stop', 'Station', 'Wait'],
			rows: records.map((row) => [
				display(row.index),
				humanName(row.station),
				Array.isArray(row.wait_conditions)
					? row.wait_conditions
							.map((condition) => humanName(record(condition).type))
							.filter(Boolean)
							.join(', ')
					: ''
			])
		});
}
function trainListView(view: ResultView, data: Data) {
	view.title = 'Trains';
	view.icon = 'location';
	view.context = [string(data.force), string(data.surface)].filter(Boolean).join(' · ');
	const trains = rows(data.trains);
	if (trains.length)
		view.tables.push({
			title: 'Trains',
			columns: ['ID', 'State', 'Station', 'Location'],
			rows: trains.map((train) => [
				display(train.train_id),
				humanName(train.state),
				humanName(train.station) || '—',
				train.x !== undefined && train.y !== undefined
					? `${display(train.x)}, ${display(train.y)}`
					: '—'
			])
		});
	view.empty = 'No trains on this surface.';
}
function settingRows(settings: Data, parent = ''): string[][] {
	return Object.entries(settings).flatMap(([key, value]) => {
		if (key.startsWith('_comment_')) return [];
		const label = [parent, humanName(key)].filter(Boolean).join(' · ');
		if (Array.isArray(value)) {
			const names = value.filter((entry): entry is string => typeof entry === 'string');
			return [
				[
					label,
					names.length === value.length ? names.join(', ') || 'None' : `${value.length} entries`
				]
			];
		}
		if (value !== null && typeof value === 'object') return settingRows(record(value), label);
		return [
			[
				label,
				value === null
					? 'None'
					: typeof value === 'boolean'
						? value
							? 'On'
							: 'Off'
						: display(value)
			]
		];
	});
}
function serverOperationView(view: ResultView, tool: string, data: Data) {
	view.icon = 'server';
	view.title = titles[tool] ?? view.title;
	const saveRows = rows(data.saves);
	const modLists = rows(data.lists);
	if (modLists.length)
		view.tables.push({
			title: 'Mod lists',
			columns: ['List', 'Factorio'],
			rows: modLists.map((list) => [string(list.name), string(list.factorioVersion)])
		});
	if (saveRows.length)
		view.tables.push({
			title: 'Saves',
			columns: ['Name', 'Size', 'Modified', ''],
			rows: saveRows.map((save) => [
				string(save.name),
				resultNumber(save.size) === undefined
					? ''
					: `${formatted(Number(save.size) / 1024 / 1024)} MB`,
				string(save.modTime),
				save.name === data.selected ? 'Selected' : ''
			])
		});
	const versions = rows(data.versions);
	if (versions.length)
		view.tables.push({
			title: 'Versions',
			columns: ['Version', 'Branch'],
			rows: versions.map((version) => [string(version.version), string(version.branch)])
		});
	const installed = record(data.installed);
	if (Object.keys(installed).length)
		view.tables.push({
			title: 'Installed versions',
			columns: ['Version', 'Branch'],
			rows: ['stable', 'experimental'].flatMap((branch) =>
				Array.isArray(installed[branch])
					? installed[branch]
							.filter((version): version is string => typeof version === 'string')
							.map((version) => [version, humanName(branch)])
					: []
			)
		});
	const selected = record(data.selected);
	if (tool === 'server_settings' || tool === 'update_server_settings') {
		const settings = tool === 'server_settings' ? data : record(data.changes);
		view.tables.push({
			title: tool === 'server_settings' ? 'Editable settings' : 'Changed settings',
			columns: ['Setting', 'Value'],
			rows: settingRows(settings)
		});
	}
	const name =
		string(data.name ?? data.selected ?? data.backup ?? data.version ?? data.action) ||
		[string(selected.version), string(selected.branch)].filter(Boolean).join(' · ');
	if (
		name ||
		data.success !== undefined ||
		data.running !== undefined ||
		data.requested === true ||
		data.activity === true
	)
		view.cards.push({
			title: name || view.title,
			badge:
				data.success === false
					? 'Failed'
					: tool === 'backup_server_save' && data.requested === true
						? 'Saving'
						: data.running === true
							? 'Running'
							: data.requested === true || data.activity === true
								? 'Requested'
								: data.success === true
									? 'Done'
									: undefined,
			tone: data.success === false ? 'warning' : data.success === true ? 'good' : 'muted',
			metrics: [],
			notes: [
				string(data.message),
				data.source ? `Source: ${data.source}` : '',
				data.startsOnNextLaunch || data.takesEffectOnNextStart ? 'Takes effect on next start.' : ''
			].filter(Boolean)
		});
	view.empty = tool === 'server_saves' ? 'No saves yet.' : 'No results.';
}
function watchView(view: ResultView, tool: string, data: Data) {
	view.title = tool === 'factory_watch_removed' ? 'Watch removed' : 'Factory watches';
	view.icon = 'production';
	const watches = tool === 'factory_watches' ? rows(data.watches) : [data];
	if (tool === 'factory_watch_removed') {
		view.cards = [
			{ title: 'Watch removed', badge: 'Removed', tone: 'muted', metrics: [], notes: [] }
		];
		return;
	}
	view.cards = watches.map((watch) => ({
		title:
			watch.kind === 'research_stalled' ? 'Research stalled' : `Deficit: ${humanName(watch.item)}`,
		prototype: watch.kind === 'item_deficit' ? prototype('item', watch.item) : undefined,
		subtitle: [string(watch.force), string(watch.surface)].filter(Boolean).join(' · '),
		badge: watch.validationError
			? 'Invalid'
			: watch.enabled === false
				? 'Paused'
				: watch.validated === false
					? 'Pending validation'
					: watch.alerting === true
						? 'Alerting'
						: 'Watching',
		tone: watch.validationError
			? 'warning'
			: watch.enabled === false || watch.validated === false
				? 'muted'
				: watch.alerting === true
					? 'warning'
					: 'good',
		metrics: [],
		notes: string(watch.validationError) ? [string(watch.validationError)] : []
	}));
	view.empty = 'No watches set.';
}
function modPlanView(view: ResultView, data: Data) {
	view.icon = 'server';
	view.title = 'Mod list review';
	view.cards = [
		{
			title: string(data.listName) || 'Mod list',
			badge: data.jobId
				? 'Update started'
				: Array.isArray(data.problems) && data.problems.length
					? 'Needs attention'
					: 'Ready to apply',
			tone: Array.isArray(data.problems) && data.problems.length ? 'warning' : 'good',
			metrics: [
				...numeric('Desired mods', data.desiredCount),
				...numeric('Server mods', data.serverCount)
			],
			notes: []
		}
	];
	const changes = rows(data.changes);
	if (changes.length)
		view.tables.push({
			title: 'Changes',
			columns: ['Action', 'Mod', 'Version'],
			rows: changes.map((change) => [
				humanName(change.kind),
				humanName(change.name),
				string(change.version)
			])
		});
	view.notes.push(
		...(Array.isArray(data.problems)
			? data.problems.filter((problem): problem is string => typeof problem === 'string')
			: [])
	);
}
function serverSetupView(view: ResultView, tool: string, data: Data) {
	view.icon = 'server';
	const inspection = tool === 'inspect_server_setup';
	view.title = tool === 'create_server_from_list' ? 'New server' : 'Server setup';
	const release = record(data.release);
	const problems = Array.isArray(data.problems)
		? data.problems.filter((problem): problem is string => typeof problem === 'string')
		: [];
	const stage = string(data.stage);
	const status = string(data.status);
	const stageLabels: Record<string, string> = {
		creating: 'Creating server',
		version: 'Installing Factorio',
		mods: 'Installing mods',
		save: 'Creating save',
		starting: 'Starting server',
		ready: 'Ready'
	};
	const badge = inspection
		? problems.length || !release.version
			? 'Needs attention'
			: 'Ready'
		: status === 'failed'
			? 'Failed'
			: status === 'done'
				? 'Ready'
				: (stageLabels[stage] ?? 'Setting up');
	view.cards = [
		{
			title: string(inspection ? data.listName : data.name) || (inspection ? 'Mod list' : 'Server'),
			subtitle: inspection ? 'Source mod list' : `From ${string(data.listName) || 'mod list'}`,
			badge,
			tone:
				badge === 'Needs attention' || status === 'failed'
					? 'warning'
					: status === 'done' || inspection
						? 'good'
						: 'muted',
			metrics: inspection ? numeric('Enabled mods', data.enabledMods) : [],
			details: [
				{
					label: 'Factorio',
					entries: [{ text: string(data.factorioVersion) || 'Version unresolved' }]
				},
				...(release.version
					? [
							{
								label: 'Release',
								entries: [
									{
										text: `${release.version}${release.branch ? ` · ${humanName(release.branch)}` : ''}`
									}
								]
							}
						]
					: []),
				...(inspection
					? []
					: [{ label: 'Save', entries: [{ text: string(data.saveName) || 'Pending' }] }])
			],
			notes: []
		}
	];
	if (inspection) {
		view.notes.push(...problems);
		if (!release.version && !problems.length)
			view.notes.push('No compatible Factorio release resolved.');
	} else if (status === 'failed') view.notes.push(string(data.error) || 'Setup failed.');
	const id = string(data.serverId);
	if (!inspection && /^[A-Za-z0-9_-]{1,100}$/u.test(id))
		view.link = { href: `/servers/${id}`, label: 'Open server' };
}
export function presentFactoryResult(item: FactoryResult): ResultView {
	const tool = item.tool ?? item.title.toLowerCase().replaceAll(' ', '_');
	const setupTool = [
		'inspect_server_setup',
		'create_server_from_list',
		'server_setup_status',
		'retry_server_setup'
	].includes(tool);
	const data = record(item.result);
	const view: ResultView = {
		title: titles[tool] ?? humanName(item.title),
		icon: 'production',
		context: context(data),
		cards: [],
		tables: [],
		notes: limits(data),
		assumptions: [],
		lines: [],
		empty: 'No matches.'
	};
	if (data.found === false || (data.error && !setupTool) || data.too_large) {
		view.notes.unshift(
			string(data.reason) || string(data.error) || 'This lookup could not return a result.'
		);
		const suggestions = listNames(data.suggestions);
		if (suggestions.length) view.notes.push(`Try: ${suggestions.join(', ')}`);
		const choices = rows(data.choices)
			.map((choice) => humanName(choice.name ?? choice.station))
			.filter(Boolean);
		if (choices.length) view.notes.push(`Choose: ${choices.join(', ')}`);
		view.empty = '';
		return view;
	}
	if (setupTool) {
		serverSetupView(view, tool, data);
	} else if (
		['production_plan', 'plan_production', 'plan_factory'].includes(tool) ||
		data.kind === 'factory_plan'
	) {
		planView(view, data);
	} else if (['factory_watches', 'factory_watch', 'factory_watch_removed'].includes(tool)) {
		watchView(view, tool, data);
	} else if (tool === 'prepare_server_mod_list') {
		modPlanView(view, data);
	} else if (tool === 'list_trains') {
		trainListView(view, data);
	} else if (tool.startsWith('inspect_')) {
		diagnosticView(view, tool, data);
	} else if (
		[
			'server_saves',
			'backup_server_save',
			'select_server_save',
			'server_control',
			'server_settings',
			'update_server_settings',
			'server_versions',
			'select_server_version',
			'server_mod_lists',
			'download_server_version'
		].includes(tool)
	) {
		serverOperationView(view, tool, data);
	} else if (
		/^(research_(add|move|remove|cancel)|train_(manual|go_to)|logistic_(set_request|clear_request))$/u.test(
			tool
		) ||
		(typeof data.operation === 'string' && 'before' in data && 'after' in data)
	) {
		actionView(view, tool, data);
	} else if (
		['available_research', 'current_research', 'research_queue', 'tech_status'].includes(tool)
	) {
		view.icon = 'research';
		const values =
			tool === 'available_research'
				? rows(data.technologies)
				: tool === 'research_queue'
					? rows(data.queue)
					: 'forces' in data
						? rows(data.forces)
						: [data];
		view.cards = values.map((row) => research(row, tool));
		view.empty =
			tool === 'available_research'
				? 'No research available.'
				: tool === 'current_research'
					? 'No active research.'
					: 'No research queued.';
	} else if (tool === 'list_forces') {
		view.icon = 'players';
		view.cards = rows(data.forces).map((row) => ({
			title: string(row.name),
			metrics: [
				...numeric('Online', row.connected_player_count),
				...numeric('Players', row.player_count)
			],
			notes: []
		}));
		if (resultNumber(data.empty)) view.notes.push(`${data.empty} empty team slots omitted.`);
	} else if (tool === 'list_players') {
		view.icon = 'players';
		view.empty = data.connected_only === false ? 'No known players.' : 'Nobody online.';
		view.cards = rows(data.players).map((row) => ({
			title: string(row.name),
			subtitle: string(row.force),
			badge: row.connected ? 'Online' : 'Offline',
			tone: row.connected ? 'good' : 'muted',
			metrics: [],
			notes: row.admin ? ['Administrator'] : []
		}));
	} else if (tool === 'server_logs') {
		view.icon = 'server';
		view.lines = Array.isArray(data.lines)
			? data.lines.filter((line): line is string => typeof line === 'string' && !!line.trim())
			: [];
		view.empty = 'No matching log lines.';
	} else if (tool === 'server_status') {
		view.icon = 'server';
		const version = record(data.version);
		view.cards = [
			{
				title: string(data.name) || 'Server',
				badge: data.failed
					? 'Failed'
					: data.stopping
						? 'Stopping'
						: data.running
							? 'Running'
							: 'Stopped',
				tone: data.failed ? 'warning' : data.running && !data.stopping ? 'good' : 'muted',
				subtitle: [version.version ? `Factorio ${version.version}` : '', string(data.save)]
					.filter(Boolean)
					.join(' · '),
				metrics: [],
				notes: []
			}
		];
	} else if (tool === 'server_mods') {
		view.icon = 'server';
		view.cards = rows(data.mods).map((row) => ({
			title: humanName(row.name),
			subtitle: string(row.version),
			badge: row.enabled ? 'Enabled' : 'Disabled',
			tone: row.enabled ? 'good' : 'muted',
			metrics: [],
			notes: []
		}));
	} else if (tool === 'sweep' || data.sweep_v) {
		view.title = humanName(data.metric) || view.title;
		view.context = [string(data.subject), string(data.unit)].filter(Boolean).join(' · ');
		view.cards = (Array.isArray(data.rows) ? data.rows : []).flatMap((row) =>
			Array.isArray(row)
				? [
						{
							title: String(row[0]),
							metrics: numeric(
								humanName(data.metric) || 'Value',
								row[1],
								data.unit ? ` ${data.unit}` : ''
							),
							notes: []
						}
					]
				: []
		);
	} else {
		if (['find_entities', 'locate_player', 'list_surfaces'].includes(tool)) view.icon = 'location';
		const title =
			humanName(data.item ?? data.fluid ?? data.name) || string(data.player) || view.title;
		const ref = data.item
			? prototype('item', data.item)
			: data.fluid
				? prototype('fluid', data.fluid)
				: ['entity_count', 'find_entities', 'built', 'kills', 'losses'].includes(tool)
					? prototype('entity', data.name)
					: undefined;
		const card = detailCard({ ...data, force: undefined, surface: undefined }, title, ref);
		if (tool === 'evolution')
			card.metrics = [
				...percent('Evolution', data.evolution_factor),
				...percent('From time', data.by_time),
				...percent('From pollution', data.by_pollution),
				...percent('From spawner kills', data.by_killing_spawners)
			];
		if (data.pollution_enabled === false) card.badge = 'Pollution disabled';
		if (card.metrics.length || card.gps || card.badge) view.cards.push(card);
		for (const key of [
			'forces',
			'surfaces',
			'items',
			'networks',
			'entities',
			'players',
			'nearby',
			'top'
		]) {
			for (const row of rows(data[key])) {
				const name =
					string(row.player ?? row.force ?? row.surface) ||
					humanName(row.item ?? row.name) ||
					(row.id !== undefined ? `Network ${row.id}` : title);
				const rowRef = row.item
					? prototype('item', row.item)
					: row.fluid
						? prototype('fluid', row.fluid)
						: key === 'entities' || key === 'nearby'
							? prototype('entity', row.name)
							: key === 'items' || key === 'top'
								? prototype('item', row.name)
								: undefined;
				view.cards.push(detailCard(row, name, rowRef));
			}
		}
	}
	return view;
}
