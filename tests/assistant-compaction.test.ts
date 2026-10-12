import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall
} from '@earendil-works/pi-ai/providers/faux';
import {
	init,
	observe,
	useAgentFinish,
	useModel,
	usePersistentState,
	useTool
} from '@flue/runtime';
import { sqlite, start } from '@flue/runtime/node';
import { assistantText, submissionEvents } from '../src/lib/server/assistant-events';

test('finish continuations see committed hook state without another tool call', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'facmandu-completion-'));
	const provider = fauxProvider({ provider: 'completion-test', models: [{ id: 'probe' }] });
	provider.setResponses([
		fauxAssistantMessage('Reviewing the answer.'),
		fauxAssistantMessage('Verified answer.')
	]);
	let reviews = 0;
	function CompletionProbe() {
		useModel('completion-test/probe');
		const [reviewed, setReviewed] = usePersistentState('reviewed', false);
		useAgentFinish(({ append }) => {
			if (reviewed) return;
			reviews++;
			setReviewed(true);
			append({ kind: 'signal', type: 'review', body: 'Review the answer before finishing.' });
		});
		return 'Answer the question.';
	}
	const runtime = await start({
		agents: [CompletionProbe],
		providers: [provider.provider],
		db: sqlite(join(directory, 'conversations.db'))
	});
	try {
		const handle = init(CompletionProbe, { id: 'completion-probe' });
		const receipt = await handle.dispatch('Answer and verify.');
		let answer: string | undefined;
		await handle.read(receipt, {
			onEvent: submissionEvents(receipt.submissionId, (chunk) => {
				answer = assistantText(answer, chunk);
			})
		});
		assert.equal(answer, 'Verified answer.');
		assert.equal(reviews, 1);
	} finally {
		await runtime.stop();
		await rm(directory, { recursive: true, force: true });
	}
});

test('long tool runs compact before the next model call and keep completed writes durable', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'facmandu-compaction-'));
	const provider = fauxProvider({
		provider: 'compaction-test',
		models: [{ id: 'probe', contextWindow: 100000, maxTokens: 1000 }]
	});
	let calls = 0;
	let summaries = 0;
	let writes = 0;
	let compacted = false;
	const stopObserving = observe((event) => {
		if (event.type === 'compaction' && !event.isError) compacted = true;
	});
	provider.setResponses(
		Array.from({ length: 12 }, () => (context) => {
			const tools = context.messages.some(
				(message) => message.role === 'system' && message.toolsAdded?.length
			);
			assert.equal(
				context.messages.some(
					(message) =>
						message.role === 'system' && message.toolsAdded?.some((tool) => tool.name === 'task')
				),
				false,
				'A model with no declared delegates must not see an unusable task tool'
			);
			if (!tools) {
				summaries++;
				return fauxAssistantMessage(
					'Goal: finish the task. The write is completed; do not repeat it.'
				);
			}
			calls++;
			if (calls === 1) return fauxAssistantMessage(fauxToolCall('write_once', {}));
			if (calls === 2) return fauxAssistantMessage(fauxToolCall('verify', {}));
			assert.ok(compacted, 'Tool history must compact before the final model request');
			return fauxAssistantMessage('Done.');
		})
	);
	function CompactionProbe() {
		const [written, setWritten] = usePersistentState('written', false);
		useModel('compaction-test/probe', {
			// Changes after the write must reach the running session at the next tool boundary.
			compaction: { reserveTokens: written ? 95000 : 1000, keepRecentTokens: 256 }
		});
		useTool({
			name: 'write_once',
			description: 'Write once.',
			run() {
				assert.equal(written, false);
				writes++;
				setWritten(true);
				return { output: 'Observed state: '.repeat(2000) };
			}
		});
		useTool({ name: 'verify', description: 'Verify the write.', run: () => ({ output: written }) });
		return 'Write once, verify, then finish. Preserve completed work during compaction.';
	}
	const runtime = await start({
		agents: [CompactionProbe],
		providers: [provider.provider],
		db: sqlite(join(directory, 'conversations.db'))
	});
	try {
		const handle = init(CompactionProbe, { id: 'probe' });
		const reply = await handle.read(await handle.dispatch('Do the task.'));
		assert.equal(reply.text, 'Done.');
		assert.equal(writes, 1);
		assert.ok(summaries > 0);
	} finally {
		stopObserving();
		await runtime.stop();
		await rm(directory, { recursive: true, force: true });
	}
});
