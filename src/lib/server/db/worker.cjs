// @ts-check
const { parentPort, workerData } = require('node:worker_threads');
/** @type {typeof import('@libsql/client')} */
const { createClient } = require(workerData.clientPath);

if (!parentPort) throw new Error('Database worker requires a parent');
const port = parentPort;
/** @type {import('@libsql/client').Config} */
const config = workerData.config;
const client = createClient({ timeout: 1000, ...config });
const ready =
	config.url.startsWith('file:') && !config.syncUrl
		? client.execute('PRAGMA journal_mode = WAL').then(() => {})
		: Promise.resolve();
/** @type {Map<number, import('@libsql/client').Transaction>} */
const transactions = new Map();

/** @param {import('@libsql/client').ResultSet} result @returns {import('./worker-client').WireResult} */
function serialize(result) {
	return {
		columns: result.columns,
		columnTypes: result.columnTypes,
		rowsAffected: result.rowsAffected,
		lastInsertRowid: result.lastInsertRowid,
		// libSQL's numeric indexes are non-enumerable; explicitly retain both access forms.
		rows: result.rows.map((row) => ({ ...row, ...Array.from(row), length: row.length }))
	};
}
/** @param {number | undefined} id */
function connection(id) {
	if (id === undefined) return client;
	const transaction = transactions.get(id);
	if (!transaction) throw new Error('Transaction is closed');
	return transaction;
}
/** @param {import('./worker-client').DatabaseRequest} message @returns {Promise<import('./worker-client').DatabaseResponse>} */
async function dispatch(message) {
	try {
		await ready;
		switch (message.operation) {
			case 'execute':
				return {
					id: message.id,
					ok: true,
					value: serialize(
						await connection(message.input.transaction).execute(message.input.statement)
					)
				};
			case 'batch': {
				const { statements, transaction, mode } = message.input;
				const results =
					transaction === undefined
						? await client.batch(statements, mode)
						: await connection(transaction).batch(statements);
				return { id: message.id, ok: true, value: results.map(serialize) };
			}
			case 'migrate':
				return {
					id: message.id,
					ok: true,
					value: (await client.migrate(message.input.statements)).map(serialize)
				};
			case 'multiple':
				await connection(message.input.transaction).executeMultiple(message.input.sql);
				break;
			case 'transaction':
				transactions.set(message.id, await client.transaction(message.input.mode));
				return { id: message.id, ok: true, value: message.id };
			case 'commit':
			case 'rollback':
			case 'release': {
				const id = message.input.transaction;
				const transaction = transactions.get(id);
				if (!transaction) {
					if (message.operation === 'commit') throw new Error('Transaction is closed');
					break;
				}
				try {
					if (message.operation === 'commit') await transaction.commit();
					else if (message.operation === 'rollback') await transaction.rollback();
				} finally {
					transaction.close();
					transactions.delete(id);
				}
				break;
			}
			case 'sync':
				return { id: message.id, ok: true, value: await client.sync() };
		}
		return { id: message.id, ok: true, value: undefined };
	} catch (cause) {
		const error = cause instanceof Error ? cause : new Error('Database operation failed');
		return {
			id: message.id,
			ok: false,
			error: {
				message: error.message,
				code: 'code' in error && typeof error.code === 'string' ? error.code : undefined,
				extendedCode:
					'extendedCode' in error && typeof error.extendedCode === 'string'
						? error.extendedCode
						: undefined,
				rawCode: 'rawCode' in error && typeof error.rawCode === 'number' ? error.rawCode : undefined
			}
		};
	}
}
/** @type {import('./worker-client').DatabaseRequest[]} */
const queue = [];
/** @type {number | undefined} */
let activeTransaction;
let executing = false;
function pump() {
	if (executing) return;
	// A replica has one connection. Hold unrelated work until commit/rollback, while letting
	// transaction statements bypass that work so the transaction can actually finish.
	const index =
		activeTransaction === undefined
			? 0
			: queue.findIndex(
					(message) =>
						'transaction' in message.input && message.input.transaction === activeTransaction
				);
	if (index < 0) return;
	const message = queue.splice(index, 1)[0];
	if (!message) return;
	executing = true;
	void dispatch(message)
		.then((response) => {
			if (message.operation === 'transaction' && response.ok) activeTransaction = message.id;
			if (
				activeTransaction !== undefined &&
				(!transactions.has(activeTransaction) || transactions.get(activeTransaction)?.closed)
			) {
				transactions.delete(activeTransaction);
				activeTransaction = undefined;
			}
			port.postMessage(response);
		})
		.finally(() => {
			executing = false;
			pump();
		});
}
port.on('message', (/** @type {import('./worker-client').DatabaseRequest} */ message) => {
	queue.push(message);
	pump();
});
