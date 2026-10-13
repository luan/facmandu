// @ts-expect-error Bun supplies this built-in at runtime; the project uses Node type declarations.
import { describe, expect, test } from 'bun:test';
import {
	panelActivity,
	panelBlueprints,
	panelDesign,
	panelDrone,
	panelUpdates
} from '../src/lib/toby-panel';

const draft = {
	kind: 'factory-result',
	tool: 'blueprint_operation',
	title: 'Blueprint',
	display: false,
	result: {
		kind: 'blueprint',
		label: 'Glass line',
		blueprint: '0abc',
		entities: [{ name: 'transport-belt', position: { x: 0.5, y: 0.5 }, width: 1, height: 1 }],
		cost: [],
		warnings: ['Missing power coverage']
	}
};
describe('Toby native harness', () => {
	test('books forward validated revision ancestry for native replacement', () => {
		const revisionOf = 'a'.repeat(64);
		const designId = 'b'.repeat(64);
		const chat = { id: 'chat', title: 'More glass', gameForce: 'player' };
		const design = { ...draft, display: true, result: { ...draft.result, designId, revisionOf } };
		expect(panelBlueprints(JSON.stringify([design]), chat, 'player')[0]?.designId).toBe(designId);
		expect(panelBlueprints(JSON.stringify([design]), chat, 'player')[0]?.revisionOf).toBe(
			revisionOf
		);
		expect(
			panelBlueprints(
				JSON.stringify([{ ...design, result: { ...design.result, revisionOf: 'invalid' } }]),
				chat,
				'player'
			)
		).toEqual([]);
	});
	test('books retain independent final modules without publishing inspections or drafts', () => {
		const first = { ...draft, display: true };
		const second = { ...first, result: { ...draft.result, label: 'Sand mine', blueprint: '0def' } };
		const inspection = {
			kind: 'factory-result',
			title: 'Factory',
			display: true,
			result: { kind: 'factory-view', surface: 'nauvis', blueprint: '0ghi' }
		};
		expect(
			panelBlueprints(
				JSON.stringify([first, draft, inspection, second]),
				{ id: 'chat', title: 'More glass', gameForce: 'player' },
				'player'
			)
		).toEqual([
			{ chatId: 'chat', title: 'More glass', label: 'Glass line', blueprint: '0abc' },
			{ chatId: 'chat', title: 'More glass', label: 'Sand mine', blueprint: '0def' }
		]);
	});
	test('only force-attested web designs are shared, without the private chat title', () => {
		const design = { ...draft, display: true, result: { ...draft.result, force: 'player' } };
		const chat = { id: 'web', title: 'Private conversation', gameForce: null };
		expect(panelBlueprints(JSON.stringify([design]), chat, 'player')).toEqual([
			{ chatId: 'web', title: 'Glass line', label: 'Glass line', blueprint: '0abc' }
		]);
		expect(panelBlueprints(JSON.stringify([design]), chat, 'other')).toEqual([]);
		expect(panelBlueprints(JSON.stringify([{ ...draft, display: true }]), chat, 'player')).toEqual(
			[]
		);
		expect(
			panelBlueprints(
				JSON.stringify([{ ...design, result: { ...design.result, blueprint: '0'.repeat(65537) } }]),
				chat,
				'player'
			)
		).toEqual([]);
	});
	test('working drafts appear before final display and retain validation warnings', () => {
		expect(panelDesign(JSON.stringify([draft]))).toMatchObject({
			label: 'Glass line',
			stage: 'Working draft',
			warnings: ['Missing power coverage']
		});
		expect(panelDesign(JSON.stringify([draft, { ...draft, display: true }]))?.stage).toBe('Design');
		expect(panelDesign('broken historic JSON')).toBeUndefined();
	});
	test('activity contains actual outcomes, errors and the current operation', () => {
		const failed = {
			kind: 'factory-result',
			tool: 'route_belt',
			title: 'Belt connection',
			result: { error: 'No route through occupied tiles' }
		};
		expect(
			panelActivity(
				JSON.stringify([draft, failed]),
				'Inspecting factory…',
				'Completed 4 factory queries.'
			)
		).toEqual([
			{ text: 'Blueprint\nDraft validated: 1 entity; 1 warning.' },
			{ text: 'Belt connection\nNo route through occupied tiles' },
			{ text: 'Inspecting factory…\nCompleted 4 factory queries.' }
		]);
	});
	test('drone activity uses public work status and does not keep speaking old facts when idle', () => {
		expect(panelDrone(true, 'Inspecting factory…', 'Completed 4 factory queries.', false)).toEqual({
			phase: 'inspecting',
			message: 'Completed 4 factory queries.'
		});
		expect(panelDrone(true, 'Drafting blueprint…', '', false).phase).toBe('working');
		expect(panelDrone(false, '', 'Old fact', false)).toEqual({ phase: 'idle', message: '' });
		expect(panelDrone(false, '', '', true).phase).toBe('error');
	});
});

test('public milestones appear in the native conversation without reading tool narration', () => {
	const updates = Array.from({ length: 6 }, (_, i) => ({
		kind: 'factory-result',
		tool: 'report_progress',
		title: 'Toby',
		result: { message: `Public ${i}` }
	}));
	expect(
		panelUpdates(
			JSON.stringify([
				...updates,
				{
					kind: 'factory-result',
					tool: 'factory_lookup',
					title: 'Read',
					result: { message: 'Internal' }
				}
			])
		)
	).toEqual(['Public 2', 'Public 3', 'Public 4', 'Public 5']);
});
