export function assistantErrorMessage(cause: unknown): string {
	// Provider responses may contain account identifiers or credentials; never echo them verbatim.
	if (cause instanceof Error && /account\b[^\n]*\bis suspended\b/iu.test(cause.message))
		return 'Your model provider suspended this account. Check billing or the monthly spending limit, then retry or choose another provider.';
	return 'Could not finish this response. Try again.';
}
