import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFactorioRichText } from '../src/lib/factorio-rich-text';

test('keeps localized text and nested Factorio formatting without markup', () => {
	assert.deepEqual(
		parseFactorioRichText('Before\n[color=red]Red [font=default-bold]bold[/font] red[/color] after'),
		[
			{ kind: 'text', text: 'Before\n', color: undefined, bold: false },
			{ kind: 'text', text: 'Red ', color: '#f87171', bold: false },
			{ kind: 'text', text: 'bold', color: '#f87171', bold: true },
			{ kind: 'text', text: ' red', color: '#f87171', bold: false },
			{ kind: 'text', text: ' after', color: undefined, bold: false }
		]
	);
});

test('recognizes prototype references and strips unsafe or unsupported tags', () => {
	const parts = parseFactorioRichText(
		'[item=iron-plate] [img=fluid/water] [color=red;position:fixed]safe[/color] [font=evil]text[/font] [tooltip=hidden]shown[/tooltip] <script>'
	);
	assert.deepEqual(parts.slice(0, 3), [
		{
			kind: 'icon',
			prototype: { kind: 'item', name: 'iron-plate' },
			caption: 'iron plate',
			color: undefined,
			bold: false
		},
		{ kind: 'text', text: ' ', color: undefined, bold: false },
		{
			kind: 'icon',
			prototype: { kind: 'fluid', name: 'water' },
			caption: 'water',
			color: undefined,
			bold: false
		}
	]);
	assert.equal(parts.filter((part) => part.kind === 'text').map((part) => part.text).join(''),
		'  safe text shown <script>');
	assert.ok(parts.every((part) => !part.color && !part.bold));
});

test('bounds color syntax and preserves malformed text', () => {
	assert.deepEqual(parseFactorioRichText('[color=1,0.5,0]orange[/color] [broken'), [
		{ kind: 'text', text: 'orange', color: 'rgb(255 128 0 / 1)', bold: false },
		{ kind: 'text', text: ' [broken', color: undefined, bold: false }
	]);
});
