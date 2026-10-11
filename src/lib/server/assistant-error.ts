export function assistantErrorMessage(cause: unknown): string {
	// Provider responses may contain account identifiers or credentials; never echo them verbatim.
	// Flue wraps the serialized provider failure in AgentRunError.cause.
	// Inspect at most four wrappers to stop cycles; extend only for a deeper provider chain.
	let error = cause;
	for (let depth = 0; depth < 4; depth++) {
		if (!error || typeof error !== 'object') break;
		if (
			'message' in error &&
			typeof error.message === 'string' &&
			/account\b[^\n]*\bis suspended\b/iu.test(error.message)
		)
			return 'Your model provider suspended this account. Check billing or the monthly spending limit, then retry or choose another provider.';
		if (!('cause' in error)) break;
		error = error.cause;
	}
	return 'Could not finish this response. Try again.';
}
