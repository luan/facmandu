import { completionDecision, completionRequest } from '$lib/assistant-completion';
import { accountProviderKeys } from './assistant-providers';

export async function assistantCompletionDecision(
	userId: string,
	requests: readonly string[],
	answer: string,
	tools: readonly { tool: string; isError: boolean }[],
	signal: AbortSignal
) {
	const key = (await accountProviderKeys(userId)).get('neuralwatt');
	if (!key) return null;
	try {
		const response = await fetch('https://api.neuralwatt.com/v1/systemone', {
			method: 'POST',
			headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
			body: JSON.stringify(completionRequest(requests, answer, tools)),
			signal: AbortSignal.any([signal, AbortSignal.timeout(5000)])
		});
		return response.ok ? completionDecision(await response.json()) : null;
	} catch (cause) {
		if (signal.aborted) throw cause;
		// Optional Clef checks must not prevent GPT-only accounts from receiving answers.
		return null;
	}
}
