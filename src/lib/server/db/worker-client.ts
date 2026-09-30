import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import type {
	Client,
	Config,
	InArgs,
	InStatement,
	Replicated,
	ResultSet,
	Transaction,
	TransactionMode
} from '@libsql/client';

export type WireResult = Omit<ResultSet, 'toJSON'>;
type Calls = {
	execute: { input: { statement: InStatement; transaction?: number }; output: WireResult };
	batch: {
		input: { statements: InStatement[]; mode?: TransactionMode; transaction?: number };
		output: WireResult[];
	};
	migrate: { input: { statements: InStatement[] }; output: WireResult[] };
	multiple: { input: { sql: string; transaction?: number }; output: undefined };
	transaction: { input: { mode?: TransactionMode }; output: number };
	commit: { input: { transaction: number }; output: undefined };
	rollback: { input: { transaction: number }; output: undefined };
	release: { input: { transaction: number }; output: undefined };
	sync: { input: Record<string, never>; output: Replicated };
};
export type DatabaseRequest = {
	[K in keyof Calls]: { id: number; operation: K; input: Calls[K]['input'] };
}[keyof Calls];
export type DatabaseResponse = { id: number } & (
	| { ok: true; value: Calls[keyof Calls]['output'] }
	| {
			ok: false;
			error: { message: string; code?: string; extendedCode?: string; rawCode?: number };
	  }
);
type Pending = {
	resolve: (value: Calls[keyof Calls]['output']) => void;
	reject: (cause: Error) => void;
};

function resultSet(result: WireResult): ResultSet {
	return {
		...result,
		toJSON: () => ({
			...result,
			lastInsertRowid: result.lastInsertRowid?.toString() ?? null,
			rows: result.rows.map((row) =>
				Array.from(row, (value) =>
					typeof value === 'bigint'
						? value.toString()
						: value instanceof ArrayBuffer
							? Buffer.from(value).toString('base64')
							: value
				)
			)
		})
	};
}

// The native libSQL replica performs synchronous network I/O. Keep its entire connection off the web event loop.
// Source is injected so Vite can bundle it as text and tests can run the same worker without a build.
export function createDatabaseClient(config: Omit<Config, 'fetch'>, source: string): Client {
	let worker: Worker;
	let closed = false;
	let nextId = 0;
	const pending = new Map<number, Pending>();
	function rejectPending(cause: Error) {
		for (const request of pending.values()) request.reject(cause);
		pending.clear();
	}
	function start() {
		const instance = new Worker(source, {
			eval: true,
			workerData: { config, clientPath: createRequire(import.meta.url).resolve('@libsql/client') }
		});
		worker = instance;
		instance.on('message', (message: DatabaseResponse) => {
			if (instance !== worker) return;
			const request = pending.get(message.id);
			if (!request) return;
			pending.delete(message.id);
			if (message.ok) request.resolve(message.value);
			else request.reject(Object.assign(new Error(message.error.message), message.error));
		});
		instance.on('error', (cause: Error) => {
			if (instance !== worker) return;
			closed = true;
			rejectPending(cause);
		});
		instance.on('exit', () => {
			if (instance !== worker) return;
			closed = true;
			rejectPending(new Error('Database worker stopped'));
		});
	}
	function call<K extends keyof Calls>(
		operation: K,
		input: Calls[K]['input']
	): Promise<Calls[K]['output']> {
		if (closed) return Promise.reject(new Error('Database is closed'));
		// Bound outage queues, but always admit work that can finish the active transaction.
		// Mutations are never timed out and silently replayed.
		if (pending.size >= 1024 && !('transaction' in input))
			return Promise.reject(new Error('Database is busy. Retry shortly.'));
		const id = ++nextId;
		return new Promise((resolve, reject) => {
			// Both sides share DatabaseRequest/Response; the operation determines this result type.
			pending.set(id, { resolve: (value) => resolve(value as Calls[K]['output']), reject });
			try {
				worker.postMessage({ id, operation, input });
			} catch (cause) {
				pending.delete(id);
				reject(cause);
			}
		});
	}
	function transaction(id: number): Transaction {
		let finished = false;
		return {
			get closed() {
				return finished || closed;
			},
			execute: (statement) => call('execute', { statement, transaction: id }).then(resultSet),
			batch: (statements) =>
				call('batch', { statements, transaction: id }).then((rows) => rows.map(resultSet)),
			executeMultiple: (sql) => call('multiple', { sql, transaction: id }),
			async commit() {
				if (finished) throw new Error('Transaction is closed');
				try {
					await call('commit', { transaction: id });
				} finally {
					finished = true;
				}
			},
			async rollback() {
				if (finished) return;
				try {
					await call('rollback', { transaction: id });
				} finally {
					finished = true;
				}
			},
			close() {
				if (finished) return;
				finished = true;
				void call('release', { transaction: id }).catch(() => {});
			}
		};
	}
	start();
	return {
		get closed() {
			return closed;
		},
		protocol: config.url.startsWith('file:') ? 'file' : config.url.startsWith('ws') ? 'ws' : 'http',
		execute: (statement: InStatement, args?: InArgs) =>
			call('execute', {
				statement: typeof statement === 'string' && args ? { sql: statement, args } : statement
			}).then(resultSet),
		batch: (statements, mode) =>
			call('batch', {
				statements: statements.map((statement) =>
					Array.isArray(statement) ? { sql: statement[0], args: statement[1] } : statement
				),
				mode
			}).then((rows) => rows.map(resultSet)),
		migrate: (statements) => call('migrate', { statements }).then((rows) => rows.map(resultSet)),
		executeMultiple: (sql) => call('multiple', { sql }),
		sync: () => call('sync', {}),
		transaction: (mode?: TransactionMode) => call('transaction', { mode }).then(transaction),
		close() {
			if (closed) return;
			closed = true;
			rejectPending(new Error('Database is closed'));
			void worker.terminate().catch(() => {});
		},
		reconnect() {
			if (!closed) return;
			closed = false;
			start();
		}
	};
}
