import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	factoryActionCommand,
	factoryActionInspectSchema,
	factoryActionSchema
} from '../src/lib/server/factory-actions';

test('factory actions require exact target and observed state', () => {
	assert.equal(
		factoryActionSchema.safeParse({
			operation: 'research_add',
			force: 'player',
			technology: 'automation'
		}).success,
		false
	);
	assert.equal(
		factoryActionSchema.safeParse({ operation: 'train_manual', trainId: 4, manual: false }).success,
		false
	);
	assert.equal(
		factoryActionSchema.safeParse({
			operation: 'logistic_set_request',
			unitNumber: 12,
			item: 'iron-plate',
			count: 10
		}).success,
		false
	);
	assert.equal(
		factoryActionSchema.safeParse({
			operation: 'research_add',
			force: 'player',
			expectedQueue: [],
			technology: 'automation'
		}).success,
		true
	);
});

test('inspection cannot accept write operations', () => {
	assert.equal(
		factoryActionInspectSchema.safeParse({ operation: 'research_inspect', force: 'player' })
			.success,
		true
	);
	assert.equal(
		factoryActionInspectSchema.safeParse({
			operation: 'research_cancel',
			force: 'player',
			expectedQueue: ['automation']
		}).success,
		false
	);
	assert.equal(
		factoryActionSchema.safeParse({ operation: 'research_inspect', force: 'player' }).success,
		false
	);
});

test('train and requester changes require snapshot fields from inspection', () => {
	const train = {
		operation: 'train_add_stop',
		trainId: 2,
		force: 'player force',
		surface: 'nauvis',
		expectedManual: true,
		expectedGroup: '',
		expectedCurrentIndex: 1,
		expectedScheduleTick: 0,
		expectedStations: [],
		station: 'QA Station',
		wait: { kind: 'time', ticks: 300 }
	};
	assert.equal(factoryActionSchema.safeParse(train).success, true);
	assert.equal(
		factoryActionSchema.safeParse({ ...train, expectedGroup: undefined }).success,
		false
	);
	const requester = {
		operation: 'logistic_set_request',
		unitNumber: 11,
		force: 'player force',
		surface: 'nauvis',
		position: { x: 0.5, y: 4.5 },
		sectionIndex: 1,
		slotIndex: 1,
		expectedRequest: null,
		item: 'iron-plate',
		quality: 'normal',
		count: 100
	};
	assert.equal(factoryActionSchema.safeParse(requester).success, true);
	assert.equal(factoryActionSchema.safeParse({ ...requester, position: undefined }).success, false);
});

test('action input is encoded as data inside a silent command', () => {
	const command = factoryActionCommand({ operation: 'research_inspect', force: 'player' });
	assert.ok(command.startsWith('/silent-command'));
	assert.ok(command.includes('helpers.json_to_table'));
	assert.ok(command.includes('Research queue changed; inspect it again'));
	assert.ok(command.includes('rcon.print(reply)'));
});
