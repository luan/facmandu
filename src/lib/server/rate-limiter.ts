type QueuedRequest = {
	url: string;
	options: RequestInit;
	resolve: (response: Response) => void;
	reject: (cause: unknown) => void;
};

class RateLimiter {
	private queue: QueuedRequest[] = [];
	private active = 0;
	private lastStart = 0;
	private timer: ReturnType<typeof setTimeout> | undefined;
	constructor(
		private readonly concurrency: number,
		private readonly intervalMs: number
	) {}

	fetch(url: string, options: RequestInit = {}): Promise<Response> {
		// Bound cold requests during portal outages; callers retain their durable cached data.
		if (this.queue.length >= 128)
			return Promise.reject(new Error('Mod portal request queue is full'));
		return new Promise((resolve, reject) => {
			this.queue.push({ url, options, resolve, reject });
			this.pump();
		});
	}
	private pump(): void {
		if (this.timer || this.active >= this.concurrency || !this.queue.length) return;
		const delay = this.lastStart + this.intervalMs - Date.now();
		if (delay > 0) {
			this.timer = setTimeout(() => {
				this.timer = undefined;
				this.pump();
			}, delay);
			return;
		}
		const request = this.queue.shift();
		if (!request) return;
		if (request.options.signal?.aborted) {
			request.reject(request.options.signal.reason);
			this.pump();
			return;
		}
		this.lastStart = Date.now();
		this.active++;
		void fetch(request.url, request.options)
			.then(request.resolve, request.reject)
			.finally(() => {
				this.active--;
				this.pump();
			});
		this.pump();
	}
}

// Metadata/search deduplicate parsed JSON in their durable cache, never consumed Response streams.
export const factorioApiLimiter = new RateLimiter(2, 500);
