import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConsoleLine } from '../src/lib/console';
import { assistantResultGroups, presentFactoryResult } from '../src/lib/factory-results';

const view = (tool: string, result: unknown) =>
	presentFactoryResult({ kind: 'factory-result', title: tool.replaceAll('_', ' '), result });
test('site search presents candidate offsets without claiming a completed factory', () => {
	const result = view('blueprint_operation', {
		operation: 'find_blueprint_site',
		surface: 'vulcanus',
		sites: [{ x: 8, y: -16 }],
		checked_positions: 4
	});
	assert.equal(result.title, 'Build site search');
	assert.equal(result.cards[0]?.badge, 'Clear footprints found');
	assert.deepEqual(result.tables[0]?.rows, [['8', '-16']]);
});

test('shared blueprint tools show source links and theoretical rates without fabricated prototype icons', () => {
	const searched = view('search_blueprints', {
		results: [
			{
				title: 'Plastic module',
				url: 'https://www.factoriocodex.com/blueprints/458/recipe-details/22921',
				rates: [{ name: 'plastic-bar', direction: 'output', quality: 0, perSecond: 15 }]
			}
		]
	});
	assert.equal(searched.cards[0]?.link?.label, 'Open source');
	assert.equal(searched.cards[0]?.details?.[0]?.entries[0]?.text, 'Plastic bar · 15/s');
	assert.equal(searched.cards[0]?.prototype, undefined);
	assert.match(searched.notes.join(' '), /Theoretical.*not checked/);
	assert.equal(
		view('search_blueprints', { results: [{ title: 'Unsafe', url: 'javascript:alert(1)' }] })
			.cards[0]?.link,
		undefined
	);
	const retrieved = view('fetch_blueprint', {
		source: 'https://www.factoriocodex.com/blueprints/458/recipe-details/22921',
		blueprint: { label: 'Plastic module', entities: [{ name: 'chemical-plant' }], tiles: [] }
	});
	assert.equal(retrieved.cards[0]?.badge, 'Retrieved');
	assert.match(retrieved.notes.join(' '), /not checked against this save/);
	assert.equal(view('fetch_blueprint', { error: 'Source timed out' }).cards.length, 0);
});

test('native saved plans show references, real prototypes and predictions without claiming a built factory', () => {
	const result = view('factory_plan', {
		planner: 'toby',
		name: 'Glass supply',
		force: 'player',
		surface: 'nauvis',
		status: 'solved',
		reference: 'toby://plan/1/42',
		products: [{ name: 'kr-glass', type: 'item', perMinute: 240 }],
		lines: [{ recipe: 'kr-glass', machine: 'electric-furnace', machines: 4 }],
		ingredients: [{ name: 'kr-sand', type: 'item', perMinute: 480 }]
	});
	assert.equal(result.reference, 'toby://plan/1/42');
	assert.deepEqual(result.cards[0]?.prototype, { kind: 'item', name: 'kr-glass' });
	assert.deepEqual(result.tables[0]?.prototypes?.[0], [
		{ kind: 'recipe', name: 'kr-glass' },
		{ kind: 'entity', name: 'electric-furnace' },
		undefined
	]);
	assert.equal(result.cards[0]?.badge, 'Calculated');
	assert.match(result.notes.join(' '), /not measured/u);
	assert.equal(
		view('factory_plan', { reference: 'https://untrusted.example' }).reference,
		undefined
	);
});

test('science snapshots show native packs and idle research without claiming a shortage', () => {
	const result = view('science_summary', {
		force: 'player',
		window: 'one_minute',
		all_qualities: true,
		research: { active: false },
		surfaces_total: 2,
		surfaces_shown: 2,
		sciences: [{ item: 'modded-card', produced_per_min: 0, consumed_per_min: 0 }]
	});
	assert.equal(result.title, 'Science production');
	assert.equal(result.cards[0]?.title, 'No active research');
	assert.equal(result.tables[0]?.previewCount, 0);
	assert.deepEqual(result.tables[0]?.rows, [['Modded card', '0', '0', '—']]);
	assert.deepEqual(result.tables[0]?.prototypes?.[0]?.[0], { kind: 'item', name: 'modded-card' });
	assert.ok(result.notes.some((note) => note.includes('zero rates alone')));
});

test('science snapshots keep active research and flowing packs above unused packs', () => {
	const result = view('science_summary', {
		research: { active: true, name: 'electronics' },
		sciences: [
			{ item: 'unused-card', produced_per_min: 0, consumed_per_min: 0 },
			{ item: 'space-science-pack', produced_per_min: 30, consumed_per_min: 0 },
			{
				item: 'automation-science-pack',
				produced_per_min: 0,
				consumed_per_min: 0,
				required_per_unit: 1
			}
		]
	});
	assert.deepEqual(
		result.tables[0]?.rows.map((row) => row[0]),
		['Automation science pack', 'Space science pack', 'Unused card']
	);
	assert.equal(result.tables[0]?.prototypes?.[1]?.[0]?.name, 'space-science-pack');
	assert.equal(result.tables[0]?.previewCount, 2);
});

test('saved research and force results render domain facts without envelope bookkeeping', () => {
	const research = view('available_research', {
		force: 'player',
		total: 2,
		shown: 2,
		technologies: [
			{ name: 'electronics', level: 1 },
			{ name: 'steam-power', level: 1 }
		]
	});
	assert.deepEqual(
		research.cards.map((card) => [card.title, card.badge]),
		[
			['Electronics', 'Available'],
			['Steam power', 'Available']
		]
	);
	assert.deepEqual(
		research.cards.map((card) => card.prototype),
		[
			{ kind: 'technology', name: 'electronics' },
			{ kind: 'technology', name: 'steam-power' }
		]
	);
	assert.deepEqual(research.notes, []);
	const force = view('list_forces', {
		total: 1,
		shown: 1,
		empty: 0,
		forces: [{ name: 'player', player_count: 0, connected_player_count: 0, engine: true }]
	});
	assert.deepEqual(
		force.cards[0]?.metrics.map((metric) => metric.value),
		['0', '0']
	);
	assert.equal(JSON.stringify(force).includes('Engine'), false);
});

test('rates, partial scans, triggers and research progress keep their meaning', () => {
	const rates = view('item_rate', {
		item: 'iron-plate',
		window: 'one_minute',
		produced_per_min: '12.50',
		consumed_per_min: 15,
		net_per_min: '-2.5'
	});
	assert.deepEqual(
		rates.cards[0]?.metrics.map((metric) => [metric.label, metric.value]),
		[
			['Produced / min', '12.5'],
			['Consumed / min', '15'],
			['Net / min', '-2.5']
		]
	);
	const scan = view('find_entities', {
		total: 10,
		shown: 1,
		truncated: true,
		entities: [{ name: 'lab', gps: '[gps=1,2,nauvis]' }]
	});
	assert.equal(scan.cards[0]?.gps, '[gps=1,2,nauvis]');
	assert.equal(scan.notes.length, 2);
	const tech = view('tech_status', {
		tech: 'electronics',
		progress: '0.25',
		trigger: { type: 'craft-item', item: { name: 'electronic-circuit' }, count: 10 },
		units: 0
	});
	assert.deepEqual(tech.cards[0]?.metrics, [{ label: 'Progress', value: '25%', fraction: 0.25 }]);
	assert.deepEqual(tech.cards[0]?.details, [
		{
			label: 'Craft',
			entries: [
				{ text: '10 × Electronic circuit', prototype: { kind: 'item', name: 'electronic-circuit' } }
			]
		}
	]);
});

test('research details retain exact prototype names for ingredient, recipe, and prerequisite icons', () => {
	const research = view('available_research', {
		force: 'player',
		technologies: [
			{
				name: 'electronics',
				ingredients: [
					{ name: 'automation-science-pack', amount: 2 },
					{ name: 'logistic-science-pack', amount: 1 }
				],
				unlocks: ['copper-cable', 'electronic-circuit'],
				unlocks_total: 3,
				prerequisites: [{ name: 'automation', researched: true }]
			}
		]
	});
	assert.deepEqual(research.cards[0]?.prototype, { kind: 'technology', name: 'electronics' });
	assert.deepEqual(research.cards[0]?.details, [
		{
			label: 'Per research unit',
			entries: [
				{
					text: '2 × Automation science pack',
					prototype: { kind: 'item', name: 'automation-science-pack' }
				},
				{
					text: '1 × Logistic science pack',
					prototype: { kind: 'item', name: 'logistic-science-pack' }
				}
			]
		},
		{
			label: 'Unlocks',
			entries: [
				{ text: 'Copper cable', prototype: { kind: 'recipe', name: 'copper-cable' } },
				{ text: 'Electronic circuit', prototype: { kind: 'recipe', name: 'electronic-circuit' } }
			]
		},
		{
			label: 'Prerequisites',
			entries: [
				{ text: 'Automation · Completed', prototype: { kind: 'technology', name: 'automation' } }
			]
		}
	]);
	assert.deepEqual(research.cards[0]?.notes, ['1 more recipe unlock']);
});

test('refusals and empty results are distinct; process failures never render as running', () => {
	assert.equal(
		view('entity_count', { found: false, reason: 'Unknown prototype', suggestions: ['lab'] }).empty,
		''
	);
	assert.equal(view('list_players', { players: [] }).empty, 'Nobody online.');
	const server = view('server_status', { running: true, stopping: true });
	assert.equal(server.cards[0]?.badge, 'Stopping');
	assert.equal(server.cards[0]?.tone, 'muted');
});

test('Factorio timestamps and severity are parsed without inventing continuation metadata', () => {
	assert.deepEqual(
		parseConsoleLine('  41.671 Info RemoteCommandProcessor.cpp:236: New RCON connection'),
		{
			timestamp: '+41.671s',
			level: 'INFO',
			clock: 'Time since Factorio started',
			text: 'RemoteCommandProcessor.cpp:236: New RCON connection'
		}
	);
	assert.equal(parseConsoleLine('2026-09-27 13:58:49 [WARNING] Repeat command').level, 'WARNING');
	assert.deepEqual(parseConsoleLine('local value = 1'), {
		timestamp: '',
		level: '',
		clock: '',
		text: 'local value = 1'
	});
});

test('empty Lua tables do not invent an active technology', () => {
	assert.deepEqual(view('current_research', { total: 0, shown: 0, forces: {} }).cards, []);
});

test('production plans show build rates, inputs and unresolved choices', () => {
	const plan = view('plan_factory', {
		kind: 'factory_plan',
		status: 'needs_choices',
		force: 'player',
		surface: 'nauvis',
		target: { name: 'electronic-circuit', type: 'item', per_min: 120 },
		steps: [
			{
				recipe: 'electronic-circuit',
				crafts_per_min: 120,
				machine: 'assembling-machine-2',
				machines: 1.067
			}
		],
		inputs: [{ name: 'iron-plate', type: 'item', per_min: 120 }],
		choices: [{ product: 'plastic-bar', recipes: [{ name: 'plastic-bar', enabled: false }] }],
		issues: ['Choose a plastic recipe.'],
		assumptions: ['Normal quality only.'],
		window: 'one_minute'
	});
	assert.equal(plan.cards[0]?.badge, 'Choose recipes');
	assert.equal(plan.cards[0]?.subtitle, undefined);
	assert.deepEqual(plan.tables[0]?.columns, ['Recipe', 'Crafts / min', 'Machines']);
	assert.deepEqual(plan.tables[0]?.rows[0], [
		'Electronic circuit',
		'120/min',
		'2 × Assembling machine 2'
	]);
	assert.deepEqual(plan.tables[1]?.rows[0], ['Iron plate', '120/min']);
	assert.deepEqual(plan.cards[1]?.details, [
		{
			label: 'Recipes',
			entries: [
				{ text: 'Plastic bar (disabled)', prototype: { kind: 'recipe', name: 'plastic-bar' } }
			]
		}
	]);
	assert.deepEqual(plan.cards[0]?.prototype, { kind: 'item', name: 'electronic-circuit' });
	assert.deepEqual(plan.tables[0]?.prototypes?.[0], [
		{ kind: 'recipe', name: 'electronic-circuit' },
		undefined,
		{ kind: 'entity', name: 'assembling-machine-2' }
	]);
	assert.deepEqual(plan.tables[1]?.prototypes?.[0]?.[0], { kind: 'item', name: 'iron-plate' });
	assert.deepEqual(plan.notes, ['Choose a plastic recipe.']);
	assert.deepEqual(plan.assumptions, ['Normal quality only.']);
	assert.match(plan.context, /1 minute/);
});

test('research actions show the resulting queue and inspect machines show diagnosis', () => {
	const empty = view('factory_action_inspect', {
		operation: 'research_inspect',
		before: { force: 'player', queue: [] },
		after: { force: 'player', queue: [] }
	});
	assert.equal(empty.title, 'Research queue');
	assert.equal(empty.empty, 'No research queued.');
	assert.deepEqual(empty.cards, []);
	const inspected = view('factory_action_inspect', {
		operation: 'research_inspect',
		before: { force: 'player', queue: ['automation'] },
		after: { force: 'player', queue: ['automation'], researching: 'automation' }
	});
	assert.equal(inspected.cards[0]?.badge, undefined);
	assert.deepEqual(inspected.cards[0]?.details, [
		{
			label: 'Order',
			entries: [{ text: 'Automation', prototype: { kind: 'technology', name: 'automation' } }]
		}
	]);
	const research = view('research_move', {
		operation: 'research_move',
		before: { force: 'player', queue: ['automation', 'logistics'] },
		after: {
			force: 'player',
			queue: ['logistics', 'automation'],
			researching: 'logistics',
			progress: 0.2
		}
	});
	assert.deepEqual(research.cards[0]?.details, [
		{
			label: 'Before',
			entries: [
				{ text: 'Automation', prototype: { kind: 'technology', name: 'automation' } },
				{ text: 'Logistics', prototype: { kind: 'technology', name: 'logistics' } }
			]
		},
		{
			label: 'Now',
			entries: [
				{ text: 'Logistics', prototype: { kind: 'technology', name: 'logistics' } },
				{ text: 'Automation', prototype: { kind: 'technology', name: 'automation' } }
			]
		}
	]);
	assert.equal(research.title, 'Research queue');
	const machine = view('inspect_machine', {
		found: true,
		name: 'assembling-machine-2',
		surface: 'nauvis',
		x: 12,
		y: 32,
		status: 'no_power',
		connected_to_power_source: false,
		recipe: { name: 'iron-gear-wheel' },
		input: { items: [{ name: 'iron-plate', count: 8 }] }
	});
	assert.equal(machine.cards[0]?.tone, 'warning');
	assert.equal(machine.cards[0]?.gps, '[gps=12,32,nauvis]');
	assert.deepEqual(machine.tables[0]?.rows[0], ['Iron plate', '8']);
});

test('server operations show save selection and version inventory', () => {
	const saves = view('server_saves', {
		saves: [{ name: 'base.zip', size: 1048576, modTime: '2026-09-27' }],
		selected: 'base.zip'
	});
	assert.deepEqual(saves.tables[0]?.rows[0], ['base.zip', '1 MB', '2026-09-27', 'Selected']);
	const versions = view('server_versions', {
		installed: { stable: ['2.0.77'], experimental: ['2.1.0'] },
		selected: { branch: 'stable', version: '2.0.77' }
	});
	assert.deepEqual(versions.tables[0]?.rows, [
		['2.0.77', 'Stable'],
		['2.1.0', 'Experimental']
	]);
});

test('watches and mod list reviews show actions without internal identifiers', () => {
	const watches = view('factory_watches', {
		watches: [
			{
				id: 'watch-secret',
				kind: 'item_deficit',
				force: 'player',
				surface: 'nauvis',
				item: 'iron-plate',
				enabled: true
			}
		]
	});
	assert.equal(watches.cards[0]?.title, 'Deficit: Iron plate');
	assert.equal(JSON.stringify(watches).includes('watch-secret'), false);
	const plan = view('prepare_server_mod_list', {
		listName: 'My mods',
		desiredCount: 2,
		serverCount: 1,
		changes: [{ kind: 'install', name: 'space-age', version: '2.0.0' }],
		problems: []
	});
	assert.deepEqual(plan.tables[0]?.rows[0], ['Install', 'Space age', '2.0.0']);
	assert.equal(plan.cards[0]?.badge, 'Ready to apply');
});

test('train discovery keeps exact IDs and schedule actions show current stop', () => {
	const trains = view('list_trains', {
		force: 'player',
		surface: 'nauvis',
		total: 1,
		shown: 1,
		trains: [{ train_id: 217, state: 'on_the_path', station: 'Iron drop', x: 12.5, y: 30 }]
	});
	assert.deepEqual(trains.tables[0]?.rows[0], ['217', 'On the path', 'Iron drop', '12.5, 30']);
	const action = view('factory_action', {
		operation: 'train_add_stop',
		before: { trainId: 217, stations: ['Iron drop'] },
		after: {
			trainId: 217,
			force: 'player',
			surface: 'nauvis',
			manual: false,
			currentIndex: 2,
			stations: ['Iron drop', 'Copper load']
		}
	});
	assert.equal(action.cards[0]?.title, 'Train 217');
	assert.deepEqual(action.tables[0]?.rows, [
		['1', 'Iron drop', ''],
		['2', 'Copper load', 'Current']
	]);
});

test('server requests and nested settings render useful status and values', () => {
	const restart = view('server_control', { requested: true, duplicate: false });
	assert.equal(restart.cards[0]?.badge, 'Requested');
	assert.equal(restart.empty, 'No results.');
	const backup = view('backup_server_save', { backup: 'safe.zip', requested: true });
	assert.equal(backup.cards[0]?.badge, 'Saving');
	const settings = view('server_settings', {
		visibility: { public: true, lan: false },
		tags: ['friends', 'vanilla'],
		_comment_tags: 'docs'
	});
	assert.deepEqual(settings.tables[0]?.rows, [
		['Visibility · Public', 'On'],
		['Visibility · Lan', 'Off'],
		['Tags', 'friends, vanilla']
	]);
});

test('server setup cards show source, release, save, progress and a local server link', () => {
	const inspection = view('inspect_server_setup', {
		kind: 'server_setup_inspection',
		listId: 'list-secret',
		listName: 'Space age',
		factorioVersion: '2.1',
		enabledMods: 14,
		release: { branch: 'stable', version: '2.1.20' },
		problems: []
	});
	assert.equal(inspection.cards[0]?.title, 'Space age');
	assert.equal(inspection.cards[0]?.badge, 'Ready');
	assert.deepEqual(inspection.cards[0]?.metrics, [{ label: 'Enabled mods', value: '14' }]);
	assert.deepEqual(inspection.cards[0]?.details, [
		{ label: 'Factorio', entries: [{ text: '2.1' }] },
		{ label: 'Release', entries: [{ text: '2.1.20 · Stable' }] }
	]);
	assert.equal(inspection.link, undefined);
	assert.equal(JSON.stringify(inspection).includes('list-secret'), false);
	const unresolved = view('inspect_server_setup', {
		listName: 'Space age',
		release: null,
		problems: []
	});
	assert.equal(unresolved.cards[0]?.badge, 'Needs attention');
	assert.equal(unresolved.cards[0]?.tone, 'warning');
	assert.deepEqual(unresolved.notes, ['No compatible Factorio release resolved.']);

	const running = view('create_server_from_list', {
		kind: 'server_setup',
		serverId: 'srv-test',
		name: 'New world',
		listName: 'Space age',
		factorioVersion: '2.1',
		saveName: 'new-world.zip',
		status: 'running',
		stage: 'save',
		error: null
	});
	assert.equal(running.cards[0]?.badge, 'Creating save');
	assert.equal(running.cards[0]?.tone, 'muted');
	assert.equal(running.cards[0]?.subtitle, 'From Space age');
	assert.deepEqual(running.link, { href: '/servers/srv-test', label: 'Open server' });
	assert.deepEqual(running.cards[0]?.details?.at(-1), {
		label: 'Save',
		entries: [{ text: 'new-world.zip' }]
	});
	const failure = view('server_setup_status', {
		serverId: 'srv-test',
		name: 'New world',
		status: 'failed',
		stage: 'mods',
		error: 'Factorio Library has no compatible release'
	});
	assert.equal(failure.cards[0]?.badge, 'Failed');
	assert.deepEqual(failure.notes, ['Factorio Library has no compatible release']);
	const retry = view('retry_server_setup', {
		serverId: 'srv-test',
		name: 'New world',
		status: 'running',
		stage: 'mods',
		saveName: 'new-world.zip'
	});
	assert.equal(retry.title, 'Server setup');
	assert.equal(retry.cards[0]?.badge, 'Installing mods');
	assert.deepEqual(retry.link, { href: '/servers/srv-test', label: 'Open server' });
	const forged = view('server_setup_status', {
		serverId: 'https://example.com',
		status: 'done',
		stage: 'ready'
	});
	assert.equal(forged.link, undefined);
});

test('logistic actions and watches label their actual state', () => {
	const action = view('factory_action', {
		operation: 'logistic_set_request',
		before: {
			unitNumber: 18,
			sectionIndex: 1,
			slotIndex: 2,
			request: { item: 'iron-plate', quality: 'normal', count: 10 }
		},
		after: {
			unitNumber: 18,
			sectionIndex: 1,
			slotIndex: 2,
			request: { item: 'iron-plate', quality: 'rare', count: 20 }
		}
	});
	assert.deepEqual(action.cards[0]?.notes, [
		'Requester 18',
		'Section 1, slot 2',
		'Quality: Rare',
		'Before: 10 · Now: 20'
	]);
	const watches = view('factory_watches', {
		watches: [
			{ kind: 'item_deficit', item: 'iron-plate', enabled: true, validated: false },
			{
				kind: 'research_stalled',
				enabled: false,
				validated: false,
				validationError: 'Unknown force'
			}
		]
	});
	assert.equal(watches.cards[0]?.badge, 'Pending validation');
	assert.equal(watches.cards[1]?.badge, 'Invalid');
	assert.deepEqual(watches.cards[1]?.notes, ['Unknown force']);
});

test('routine reads stay in activity while requested displays and pending reviews remain visible', () => {
	const read = {
		kind: 'factory-result' as const,
		tool: 'server_context',
		title: 'Server',
		result: {}
	};
	const display = { ...read, display: true };
	const review = { ...read, tool: 'prepare_server_mod_list' };
	const apply = { ...read, tool: 'apply_server_mod_list' };
	assert.deepEqual(assistantResultGroups([read, display, review]), {
		primary: [display, review],
		details: [read]
	});
	assert.deepEqual(assistantResultGroups([read, review, apply, read]), {
		primary: [],
		details: [read, review, apply, read]
	});
	assert.deepEqual(assistantResultGroups([read, review, apply, review]), {
		primary: [review],
		details: [read, review, apply]
	});
});

test('wire observations identify their endpoints and keep failed reads distinct from disconnections', () => {
	const connection = {
		operation: 'wire_inspect',
		source: { name: 'medium-electric-pole', position: { x: 0.5, y: 0.5 } },
		target: { name: 'medium-electric-pole', position: { x: 7.5, y: 0.5 } },
		connected: false,
		canReach: true
	};
	const wires = view('factory_action_inspect', {
		operation: 'wire_inspect_batch',
		connections: [
			{ index: 1, ok: true, result: connection },
			{ index: 2, ok: false, error: 'Entity changed; inspect it again' }
		]
	});
	assert.deepEqual(wires.tables[0]?.rows, [
		['1', 'Medium electric pole (0.5, 0.5)', 'Medium electric pole (7.5, 0.5)', 'No', 'Yes', ''],
		['2', '—', '—', 'Not checked', 'Not checked', 'Entity changed; inspect it again']
	]);
	assert.equal(view('factory_action_inspect', connection).tables[0]?.rows[0]?.[3], 'No');
});

test('blueprint placement reports incomplete work and actionable blocked coordinates', () => {
	const placed = view('blueprint_operation', {
		operation: 'place_blueprint',
		surface: 'nauvis',
		requested: 3,
		placed: 1,
		complete: false,
		error: 'Site changed during placement'
	});
	assert.equal(placed.cards[0]?.badge, 'Incomplete');
	assert.deepEqual(placed.cards[0]?.metrics, [
		{ label: 'Placed ghosts', value: '1' },
		{ label: 'Requested entities', value: '3' }
	]);
	assert.deepEqual(placed.cards[0]?.notes, ['Site changed during placement']);
	const blocked = view('blueprint_operation', {
		ready: false,
		surface: 'nauvis',
		entities: 2,
		blocked: [{ name: 'transport-belt', position: { x: 50.5, y: 50.5 }, reason: 'Occupied' }]
	});
	assert.equal(blocked.cards[0]?.badge, 'Blocked');
	assert.deepEqual(blocked.tables[0]?.rows, [['Transport belt', '50.5', '50.5', 'Occupied']]);
});

test('placement clearance keeps power gaps and partial evidence visible', () => {
	const inspection = (checked: boolean, gaps: number) =>
		view('blueprint_operation', {
			ready: true,
			surface: 'nauvis',
			entities: 30,
			power: { checked, uncovered_total: 0, unconnected_total: gaps }
		});
	const disconnected = inspection(true, 29);
	assert.equal(disconnected.cards[0]?.badge, 'Placement clear');
	assert.equal(disconnected.cards[1]?.badge, 'Gaps found');
	assert.deepEqual(disconnected.cards[1]?.metrics, [
		{ label: 'Without pole coverage', value: '0' },
		{ label: 'Without source connection', value: '29' }
	]);
	assert.equal(inspection(false, 0).cards[1]?.badge, 'Partial scan');
	assert.equal(inspection(true, 0).cards[1]?.badge, 'Reach checked');
	assert.match(
		inspection(true, 0).cards[1]?.notes[0] ?? '',
		/actual wiring and power capacity need checking/u
	);
});

test('only the latest displayed factory inspection is inline and all captures remain available', () => {
	const capture = (tick: number, display = true) => ({
		kind: 'factory-result' as const,
		tool: 'factory_view',
		title: 'Inspection',
		display,
		result: { tick }
	});
	const first = capture(1);
	const second = capture(2);
	const scouting = capture(3, false);
	const design = { ...first, tool: 'blueprint_operation' };
	const plan = { ...first, tool: 'production_plan' };
	const revisedPlan = { ...second, tool: 'production_plan' };
	const results = [first, plan, design, second, revisedPlan, scouting];
	assert.deepEqual(assistantResultGroups(results), {
		primary: [second, revisedPlan],
		details: [first, plan, design, scouting]
	});
	assert.deepEqual(
		results.map((item) => item.result.tick),
		[1, 1, 1, 2, 2, 3]
	);
});

test('legacy blueprints without saved identities retain the compact latest-export view', () => {
	const design = (label: string, blueprint: string) => ({
		kind: 'factory-result' as const,
		tool: 'blueprint_operation',
		title: 'Blueprint',
		display: true,
		result: { label, blueprint }
	});
	const first = design('Plastic', 'first');
	const alternative = design('Oil processing', 'alternative');
	const revision = design('Plastic', 'revision');
	assert.deepEqual(assistantResultGroups([first, alternative, revision]), {
		primary: [revision],
		details: [first, alternative]
	});
});

test('independent saved designs stay available while explicit revisions and repeated renders fold', () => {
	const design = (id: string, revisionOf?: string, display = true) => ({
		kind: 'factory-result' as const,
		tool: 'blueprint_operation',
		title: 'Blueprint',
		display,
		result: { kind: 'blueprint', designId: id.repeat(64), revisionOf: revisionOf?.repeat(64) }
	});
	const glass = design('a'),
		science = design('b'),
		revisedGlass = design('c', 'a');
	const render = { ...revisedGlass, tool: 'render_blueprint' };
	const unfinishedScience = design('d', 'b', false);
	assert.deepEqual(
		assistantResultGroups([glass, science, revisedGlass, render, unfinishedScience]),
		{
			primary: [science, render],
			details: [glass, revisedGlass, unfinishedScience]
		}
	);
});

test('repeated science snapshots stay inspectable while distinct forces and windows remain inline', () => {
	const snapshot = (force: string, window: string, tick: number) => ({
		kind: 'factory-result' as const,
		tool: 'science_summary',
		title: 'Science',
		display: true,
		result: { force, window, observed_at_tick: tick }
	});
	const first = snapshot('player', 'one_minute', 1),
		other = snapshot('friends', 'one_minute', 2),
		hour = snapshot('player', 'one_hour', 3),
		latest = snapshot('player', 'one_minute', 4);
	assert.deepEqual(assistantResultGroups([first, other, hour, latest]), {
		primary: [other, hour, latest],
		details: [first]
	});
});

test('territory inspection shows world bounds and leaves unknown territory uncertain', () => {
	const result = view('inspect_territory', {
		surface: 'vulcanus',
		counts: { guarded: 1, unguarded: 2, cleared: 1, unknown: 0, unexplored: 1 },
		chunks: [
			{ x: -1, y: 0, status: 'guarded' },
			{ x: 0, y: 0, status: 'cleared' }
		],
		note: 'Other enemies and terrain need separate checks.'
	});
	assert.equal(result.title, 'Demolisher territory');
	assert.equal(result.cards[0]?.badge, 'Guarded chunks');
	assert.deepEqual(result.tables[0]?.rows[0], ['-32, 0', '0, 32', 'Guarded']);
	assert.match(result.cards[0]?.notes[0] ?? '', /Other enemies/);
	assert.equal(
		view('inspect_territory', {
			surface: 'vulcanus',
			counts: { guarded: 0, unknown: 1 },
			chunks: []
		}).cards[0]?.badge,
		'Partial territory scan'
	);
});
