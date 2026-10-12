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
		if ('message' in error && typeof error.message === 'string') {
			if (/\boverloaded\b|overloaded_error/iu.test(error.message))
				return 'The model provider is temporarily overloaded. Your work is saved; wait briefly and retry, or choose another model.';
			if (/exceeded request buffer limit/iu.test(error.message))
				return 'The model provider rejected an oversized request. Completed actions and designs are saved; retry to continue from them.';
			if (/socket connection was closed unexpectedly/iu.test(error.message))
				return 'The model connection kept dropping. Your work is saved; retry to continue.';
			if (/tpm_uncached_exceeded/iu.test(error.message))
				return 'The provider rejected too much uncached conversation context. Your work is saved; start a new chat or choose another model to continue.';
			if (/\b429\b|rate.limit/iu.test(error.message))
				return 'The model provider is temporarily rate-limiting requests. Your work is saved; wait briefly and retry.';
		}
		if (!('cause' in error)) break;
		error = error.cause;
	}
	return 'Could not finish this response. Try again.';
}
