/**
 * Rate limiter with request deduplication for Factorio API calls
 * Prevents overwhelming the external API with too many concurrent requests
 * and avoids duplicate requests for the same resource
 */

interface QueuedRequest {
	resolve: (value: Response) => void;
	reject: (error: Error) => void;
	url: string;
	options: RequestInit;
}

interface PendingRequest {
	promise: Promise<Response>;
	timestamp: number;
}

class RateLimiter {
	private queue: QueuedRequest[] = [];
	private activeRequests = 0;
	private readonly maxConcurrent: number;
	private readonly delayBetweenRequests: number;
	private lastRequestTime = 0;
	private pendingRequests = new Map<string, PendingRequest>();

	constructor(maxConcurrent: number = 3, delayBetweenRequests: number = 200) {
		this.maxConcurrent = maxConcurrent;
		this.delayBetweenRequests = delayBetweenRequests;
		// Clean up expired pending requests every minute
		setInterval(() => this.cleanup(), 60000);
	}

	async fetch(url: string, options: RequestInit = {}): Promise<Response> {
		const key = this.getRequestKey(url, options);

		// Check for existing pending request (deduplication)
		const existing = this.pendingRequests.get(key);
		if (existing && Date.now() - existing.timestamp < 30000) {
			// 30 second deduplication window
			return existing.promise;
		}

		return new Promise<Response>((resolve, reject) => {
			this.queue.push({ resolve, reject, url, options });
			this.processQueue();
		});
	}

	private getRequestKey(url: string, options: RequestInit): string {
		// Create a unique key based on URL and relevant options
		const method = options.method || 'GET';
		const body = options.body ? JSON.stringify(options.body) : '';
		return `${method}:${url}:${body}`;
	}

	private async processQueue(): Promise<void> {
		if (this.activeRequests >= this.maxConcurrent || this.queue.length === 0) {
			return;
		}

		const request = this.queue.shift()!;
		this.activeRequests++;

		// Add to pending requests for deduplication
		const key = this.getRequestKey(request.url, request.options);

		try {
			// Ensure minimum delay between requests
			const now = Date.now();
			const timeSinceLastRequest = now - this.lastRequestTime;
			if (timeSinceLastRequest < this.delayBetweenRequests) {
				await new Promise((resolve) =>
					setTimeout(resolve, this.delayBetweenRequests - timeSinceLastRequest)
				);
			}

			this.lastRequestTime = Date.now();
			const promise = fetch(request.url, request.options);

			// Store in pending requests
			this.pendingRequests.set(key, {
				promise,
				timestamp: Date.now()
			});

			const response = await promise;
			request.resolve(response);
		} catch (error) {
			request.reject(error instanceof Error ? error : new Error('Unknown error'));
		} finally {
			this.activeRequests--;
			this.pendingRequests.delete(key);
			// Process next request in queue
			setTimeout(() => this.processQueue(), 0);
		}
	}

	private cleanup(): void {
		const now = Date.now();
		for (const [key, request] of this.pendingRequests.entries()) {
			if (now - request.timestamp > 30000) {
				// 30 second cleanup
				this.pendingRequests.delete(key);
			}
		}
	}
}

// Global rate limiter instance for Factorio API
export const factorioApiLimiter = new RateLimiter(2, 500); // Max 2 concurrent, 500ms between requests
