import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	boundedConsoleLines,
	commandCompletions,
	consoleLevel,
	consoleText,
	highlightCommand,
	isLuaLine
} from '../src/lib/console';

test('console replay keeps recent output within both row and text limits', () => {
	const lines = Array.from({ length: 3000 }, (_, id) => ({ id, text: String(id) }));
	const recent = boundedConsoleLines(lines);
	assert.equal(recent.length, 2000);
	assert.equal(recent[0]?.id, 1000);
	assert.equal(recent.at(-1)?.id, 2999);
	const long = boundedConsoleLines(
		lines.map((line) => ({ ...line, text: consoleText('x'.repeat(4100)) }))
	);
	assert.ok(long.reduce((size, line) => size + line.text.length, 0) <= 256 * 1024);
	assert.equal(long.at(-1)?.id, 2999);
	assert.ok(long.every((line) => line.text.endsWith('[truncated]')));
	assert.equal(lines.length, 3000);
});

test('completion and highlighting preserve literal commands without HTML interpretation', () => {
	assert.ok(commandCompletions('/pla').some((choice) => choice.value === '/players'));
	const command = '/c rcon.print("<img src=x onerror=alert(1)>")';
	const tokens = highlightCommand(command);
	assert.equal(tokens.map((token) => token.text).join(''), command);
	assert.ok(tokens.some((token) => token.kind === 'string'));
});

test('Lua source stays readable without becoming an error log', () => {
	const code = 'if not result then error("failed") end -- warning';
	assert.equal(consoleLevel(code), 'info');
	assert.equal(consoleLevel('  1.100 Error Server.cpp:10: failed'), 'error');
	assert.equal(consoleLevel('2026-09-27 13:58:49 [WARNING] test'), 'warning');
	assert.equal(isLuaLine(code), true);
	assert.equal(isLuaLine(' 1.100 Info Server.cpp:10: started'), false);
	const tokens = highlightCommand(code);
	assert.equal(tokens.map((token) => token.text).join(''), code);
	assert.ok(tokens.some((token) => token.kind === 'comment'));
	assert.equal(
		highlightCommand('rcon.print([=[hello "world"]=])').find((token) => token.kind === 'string')
			?.text,
		'[=[hello "world"]=]'
	);
});
