import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { parseModSettingsLua } from '../src/lib/server/mod-settings-lua';

test('reads types, defaults, ranges, and allowed values', () => {
	const defs = parseModSettingsLua(`
data:extend({
  { type = "bool-setting", name = "m-flag", setting_type = "startup", default_value = true, order = "a" },
  { type = "int-setting", name = "m-count", setting_type = "runtime-global", default_value = 4, minimum_value = 1, maximum_value = 8 },
  { type = "double-setting", name = "m-ratio", setting_type = "startup", default_value = 1.5 },
  { type = "string-setting", name = "m-mode", setting_type = "startup", default_value = "b", allowed_values = {"a", "b"} },
})`);
	assert.equal(defs.length, 4);
	assert.deepEqual(defs[0], {
		name: 'm-flag',
		type: 'bool-setting',
		kind: 'boolean',
		settingType: 'startup',
		default: true,
		order: 'a'
	});
	assert.deepEqual(defs[1], {
		name: 'm-count',
		type: 'int-setting',
		kind: 'number',
		settingType: 'runtime-global',
		default: 4,
		minimum: 1,
		maximum: 8,
		order: ''
	});
	assert.deepEqual(defs[3]?.allowed, ['a', 'b']);
});

test('handles loops, helper functions, and paren-less extend', () => {
	const defs = parseModSettingsLua(`
local opts = function() return {"x", "y"} end
local names = {"one", "two"}
for _, n in pairs(names) do
  data:extend{{
      type = "string-setting",
      name = "m-" .. n,
      setting_type = "startup",
      default_value = "x",
      allowed_values = opts(),
  }}
end`);
	assert.equal(defs.length, 2);
	assert.deepEqual(defs[0]?.allowed, ['x', 'y']);
});

test('reads color defaults and skips unknown types', () => {
	const defs = parseModSettingsLua(`
data:extend({
	{ type = "color-setting", name = "m-color", setting_type = "startup", default_value = {r=1,g=0.5,b=0,a=1} },
	{ type = "unknown-setting", name = "m-unknown", setting_type = "startup", default_value = true },
	{ type = "bool-setting", name = "m-ok", setting_type = "startup", default_value = false },
})`);
	assert.equal(defs.length, 2);
	assert.deepEqual(defs[0]?.default, { r: 1, g: 0.5, b: 0, a: 1 });
	assert.equal(defs[1]?.name, 'm-ok');
});

test('normalizes short and partial color defaults', () => {
	const defs = parseModSettingsLua(`data:extend({
		{ type = "color-setting", name = "short", setting_type = "startup", default_value = {0.25, 0.5, 1} },
		{ type = "color-setting", name = "partial", setting_type = "startup", default_value = {r = 1} }
	})`);
	assert.deepEqual(
		defs.map((def) => def.default),
		[
			{ r: 0.25, g: 0.5, b: 1, a: 1 },
			{ r: 1, g: 0, b: 0, a: 1 }
		]
	);
});

test('reads numeric allowed values without string coercion', () => {
	const defs = parseModSettingsLua(
		'data:extend({{type="int-setting",name="m-level",setting_type="startup",default_value=2,allowed_values={1,2,3}}})'
	);
	assert.deepEqual(defs[0]?.allowed, [1, 2, 3]);
});

test('mutation-only files yield no definitions', () => {
	const defs = parseModSettingsLua(`
if mods["other"] then
  data.raw["bool-setting"]["x"].hidden = true
end`);
	assert.deepEqual(defs, []);
});

test('hostile files cannot touch the host or hang', () => {
	assert.throws(() => parseModSettingsLua('os.execute("touch /tmp/pwned")'));
	// The instruction cap must fire instead of hanging; the exact error value is fengari-specific.
	assert.throws(() => parseModSettingsLua('while true do end'));
	assert.ok(!existsSync('/tmp/pwned'), 'os library stays disabled');
});

test('resolves sibling modules through require', () => {
	const siblings: Record<string, string> = {
		'shared.lua': 'return { prefix = "m-", flag = true }',
		'missing-user.lua': 'error("unavailable")'
	};
	const defs = parseModSettingsLua(
		`
local shared = require("shared")
local broken = require("missing-user")
data:extend({
  { type = "bool-setting", name = shared.prefix .. "flag", setting_type = "startup", default_value = shared.flag },
  { type = "bool-setting", name = "m-other", setting_type = "startup", default_value = broken ~= nil },
})`,
		{ readSibling: (path) => siblings[path] ?? null }
	);
	assert.equal(defs.length, 2);
	assert.equal(defs[0]?.name, 'm-flag');
});

test('missing siblings degrade to placeholders', () => {
	const defs = parseModSettingsLua(
		'local x = require("nope")\ndata:extend({{ type = "bool-setting", name = "m-x", setting_type = "startup", default_value = x ~= nil }})'
	);
	assert.equal(defs[0]?.default, true);
});

test('helpers gate settings on the game version', () => {
	const source = `
if helpers.compare_versions(helpers.game_version, "2.1.0") < 0 then
  data:extend({{ type = "bool-setting", name = "m-old", setting_type = "startup", default_value = false }})
end`;
	assert.equal(parseModSettingsLua(source, { gameVersion: '2.0.55' }).length, 1);
	assert.equal(parseModSettingsLua(source, { gameVersion: '2.1.0' }).length, 0);
	assert.equal(parseModSettingsLua(source).length, 1);
});

test('unconditional data.raw access does not fail the file', () => {
	const defs = parseModSettingsLua(
		'data.raw["bool-setting"]["x"].hidden = true\ndata:extend({{ type = "bool-setting", name = "m-x", setting_type = "startup", default_value = true }})'
	);
	assert.equal(defs.length, 1);
});

test('broken siblings degrade instead of hiding settings', () => {
	const defs = parseModSettingsLua(
		'local x = require("broken")\ndata:extend({{ type = "bool-setting", name = "m-x", setting_type = "startup", default_value = true }})',
		{ readSibling: () => 'this is not lua ((( ' }
	);
	assert.equal(defs.length, 1);
});

test('double-underscore requires resolve within the same mod', () => {
	const defs = parseModSettingsLua(
		'local c = require("__mymod__.constants")\ndata:extend({{ type = "bool-setting", name = "m-x", setting_type = "startup", default_value = c.flag }})',
		{
			modName: 'mymod',
			readSibling: (path) => (path === 'constants.lua' ? 'return { flag = true }' : null)
		}
	);
	assert.equal(defs[0]?.default, true);
});

test('foreign double-underscore requires stay placeholders', () => {
	const defs = parseModSettingsLua(
		'local c = require("__other__.constants")\ndata:extend({{ type = "bool-setting", name = "m-x", setting_type = "startup", default_value = c ~= nil }})',
		{ modName: 'mymod', readSibling: () => 'return { flag = true }' }
	);
	assert.equal(defs[0]?.default, true);
});

test('debug.getinfo reports the Factorio-style short source', () => {
	const defs = parseModSettingsLua(
		'local src = debug.getinfo(1, "S").short_src\ndata:extend({{ type = "string-setting", name = "m-x", setting_type = "startup", default_value = src }})',
		{ modName: 'mymod' }
	);
	assert.equal(defs[0]?.default, '__mymod/?.lua');
});
