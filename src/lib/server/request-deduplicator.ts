/**
 * Request deduplicator to prevent multiple concurrent requests for the same resource
 * Useful for API endpoints that might be called multiple times simultaneously
 */

interface PendingRequest {
	promise: Promise<Response>;
	timestamp: number;
}

class RequestDeduplicator {
	private pendingRequests = new Map<string, PendingRequest>();
	private readonly ttlMs: number;

	constructor(ttlMs: number = 30000) {
		// 30 second TTL
		this.ttlMs = ttlMs;
		// Clean up expired requests every minute
		setInterval(() => this.cleanup(), 60000);
	}

	async fetch(url: string, options: RequestInit = {}): Promise<Response> {
		const key = this.getRequestKey(url, options);

		// Check if we have a pending request for this resource
		const existing = this.pendingRequests.get(key);
		if (existing && Date.now() - existing.timestamp < this.ttlMs) {
			// Return the existing promise (will resolve for all callers)
			return existing.promise;
		}

		// Create new request
		const promise = fetch(url, options);
		this.pendingRequests.set(key, {
			promise,
			timestamp: Date.now()
		});

		// Clean up after request completes
		promise.finally(() => {
			this.pendingRequests.delete(key);
		});

		return promise;
	}

	private getRequestKey(url: string, options: RequestInit): string {
		// Create a unique key based on URL and relevant options
		const method = options.method || 'GET';
		const body = options.body ? JSON.stringify(options.body) : '';
		return `${method}:${url}:${body}`;
	}

	private cleanup(): void {
		const now = Date.now();
		for (const [key, request] of this.pendingRequests.entries()) {
			if (now - request.timestamp > this.ttlMs) {
				this.pendingRequests.delete(key);
			}
		}
	}
}

// Global deduplicator instance for Factorio API requests
export const factorioApiDeduplicator = new RequestDeduplicator(30000);
