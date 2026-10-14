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
	useDataWriter,
	useModel,
	usePersistentState,
	useSubagent,
	useTool
} from '@flue/runtime';
import { sqlite, start } from '@flue/runtime/node';
import { assistantFinalText, assistantText, submissionEvents } from '../src/lib/assistant-events';

test('read-only surveys use a fast model without changing the parent design effort', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'facmandu-survey-model-'));
	const parent = fauxProvider({
		provider: 'survey-parent',
		models: [{ id: 'design', reasoning: true }]
	});
	const survey = fauxProvider({
		provider: 'survey-worker',
		models: [{ id: 'fast', reasoning: true }]
	});
	parent.setResponses([
		(_context, options) => {
			assert.equal(options?.reasoning, 'high');
			return fauxAssistantMessage([
				fauxToolCall('task', {
					agent: 'factory_surveyor',
					prompt: 'Read the assigned production facts.'
				})
			]);
		},
		(_context, options) => {
			assert.equal(options?.reasoning, 'high');
			return fauxAssistantMessage('Design complete.');
		}
	]);
	survey.setResponses([
		(_context, options) => {
			assert.equal(options?.reasoning, 'low');
			return fauxAssistantMessage('Observed inputs and rates.');
		}
	]);
	function SurveyModelProbe() {
		useModel('survey-parent/design', { thinkingLevel: 'high' });
		useSubagent({
			name: 'factory_surveyor',
			description: 'Read-only production survey.',
			model: 'survey-worker/fast',
			thinkingLevel: 'low',
			agent: () => 'Read the production facts only.'
		});
		return 'Use the production survey to complete the design.';
	}
	const runtime = await start({
		agents: [SurveyModelProbe],
		providers: [parent.provider, survey.provider],
		db: sqlite(join(directory, 'conversations.db'))
	});
	try {
		const handle = init(SurveyModelProbe, { id: 'survey-model-probe' });
		assert.equal(
			(await handle.read(await handle.dispatch('Complete the design.'))).text,
			'Design complete.'
		);
		assert.equal(parent.state.callCount, 2);
		assert.equal(survey.state.callCount, 1);
	} finally {
		await runtime.stop();
		await rm(directory, { recursive: true, force: true });
	}
});

test('zero durability deadline lets an active submission pass one hour without stopping', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'facmandu-deadline-'));
	const provider = fauxProvider({ provider: 'deadline-test', models: [{ id: 'probe' }] });
	provider.setResponses([
		fauxAssistantMessage([fauxToolCall('advance_clock', {})]),
		fauxAssistantMessage('Finished after the old deadline.')
	]);
	const originalNow = Date.now;
	let offset = 0;
	function DeadlineProbe() {
		useModel('deadline-test/probe');
		useTool({
			name: 'advance_clock',
			description: 'Advance the test clock.',
			run: () => {
				offset = 61 * 60 * 1000;
				return { output: 'Clock advanced.' };
			}
		});
		return 'Continue after the clock advances.';
	}
	DeadlineProbe.durability = { timeoutMs: 0 };
	const runtime = await start({
		agents: [DeadlineProbe],
		providers: [provider.provider],
		db: sqlite(join(directory, 'conversations.db'))
	});
	Date.now = () => originalNow() + offset;
	try {
		const handle = init(DeadlineProbe, { id: 'deadline' });
		const receipt = await handle.dispatch('Finish this request.');
		assert.equal((await handle.read(receipt)).text, 'Finished after the old deadline.');
	} finally {
		Date.now = originalNow;
		await runtime.stop();
		await rm(directory, { recursive: true, force: true });
	}
});

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
		const writeAnswer = useDataWriter('assistant-answer');
		const [reviewed, setReviewed] = usePersistentState('reviewed', false);
		useAgentFinish(({ append }) => {
			if (reviewed) {
				writeAnswer('Verified answer.');
				return;
			}
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
		const reply = await handle.read(receipt, {
			onEvent: submissionEvents(receipt.submissionId, (chunk) => {
				answer = assistantText(answer, chunk);
			})
		});
		assert.equal(answer, 'Verified answer.');
		assert.equal(reviews, 1);
		assert.equal(
			assistantFinalText(reply, 'Preliminary answer.Verified answer.'),
			'Verified answer.'
		);
		assert.equal(assistantFinalText(await handle.read(receipt.submissionId)), 'Verified answer.');
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
