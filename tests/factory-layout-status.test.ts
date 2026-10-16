import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	markCompiledFactory,
	recordCompiledFactoryTrial,
	requireCompiledFactoryTrial
} from '../src/lib/server/factory-layout-status';

test('compiled factories require a completed passing trial on their own force before ghost placement', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'toby-layout-'));
	const designId = 'a'.repeat(64);
	try {
		await markCompiledFactory(directory, 'player', designId);
		await assert.rejects(requireCompiledFactoryTrial(directory, 'player', designId), /not passed/);
		for (const trial of [
			{ status: 'running', passed: true },
			{ status: 'done', passed: false }
		]) {
			await recordCompiledFactoryTrial(directory, 'player', { designId, ...trial });
			await assert.rejects(
				requireCompiledFactoryTrial(directory, 'player', designId),
				/not passed/
			);
		}
		await assert.rejects(
			recordCompiledFactoryTrial(directory, 'other', { designId, status: 'done', passed: true }),
			/another force/
		);
		await recordCompiledFactoryTrial(directory, 'player', {
			designId,
			status: 'done',
			passed: true
		});
		await requireCompiledFactoryTrial(directory, 'player', designId);
		await assert.rejects(
			requireCompiledFactoryTrial(directory, 'other', designId),
			/another force/
		);
		await requireCompiledFactoryTrial(directory, 'player', 'b'.repeat(64));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
