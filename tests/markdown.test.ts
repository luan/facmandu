import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderMarkdown } from '../src/lib/markdown';

test('assistant replies render lists, emphasis and code without active HTML or images', () => {
	const rendered = renderMarkdown(
		'- **Inspect mods**\n- `base`\n\n<script>alert(1)</script>\n\n[bad](javascript:alert%281%29)\n\n![remote](https://example.com/tracking.png)'
	);
	assert.ok(rendered.includes('<ul>'));
	assert.ok(rendered.includes('<strong>Inspect mods</strong>'));
	assert.ok(rendered.includes('<code>base</code>'));
	assert.ok(!rendered.includes('<script>'));
	assert.ok(!rendered.includes('href="javascript:'));
	assert.ok(!rendered.includes('<img'));
});

test('assistant comparisons render accessible tables with inline formatting and safe cells', () => {
	const rendered = renderMarkdown(`| Mod | What it adds here | Main consideration |
| :--- | --- | ---: |
| **Resource Monitor** | Tracks ore-site depletion | Scanning may be slow |
| P.U.M.P. | Plans pumps \\| pipes | Uses \`flib\` |
| [Details](https://mods.factorio.com) | <script>alert(1)</script> | ![remote](https://example.com/tracking.png) |`);
	assert.ok(rendered.includes('role="region" aria-label="Table" tabindex="0"><table>'));
	assert.equal((rendered.match(/<tr>/g) ?? []).length, 4);
	assert.ok(rendered.includes('<th align="left">Mod</th>'));
	assert.ok(rendered.includes('<td align="right">Uses <code>flib</code></td>'));
	assert.ok(rendered.includes('<strong>Resource Monitor</strong>'));
	assert.ok(rendered.includes('Plans pumps | pipes'));
	assert.ok(rendered.includes('href="https://mods.factorio.com"'));
	assert.ok(!rendered.includes('<script>'));
	assert.ok(!rendered.includes('<img'));
});

test('server replies use native prototype icons while preserving literal commands and safe markup', () => {
	const rendered = renderMarkdown(
		'**[item=plastic-bar]** and [img=fluid/petroleum-gas]\n\n`[item=coal]`\n\n```lua\ngame.print("[item=coal]")\n```\n\n[external](https://example.com/[item=coal])\n\n[item=../../secret] ![remote](https://example.com/tracker.png)',
		'legacy'
	);
	assert.ok(rendered.includes('src="/api/servers/legacy/icons/item/plastic-bar"'));
	assert.ok(rendered.includes('src="/api/servers/legacy/icons/fluid/petroleum-gas"'));
	assert.ok(rendered.includes('<code>[item=coal]</code>'));
	assert.ok(rendered.includes('game.print(&quot;[item=coal]&quot;)'));
	assert.ok(rendered.includes('href="https://example.com/%5Bitem=coal%5D"'));
	assert.equal((rendered.match(/<img /gu) ?? []).length, 2);
	assert.ok(!rendered.includes('src="https:'));
	assert.ok(!rendered.includes('/icons/item/../../secret'));
	assert.ok(!renderMarkdown('[item=plastic-bar]').includes('<img'));
});
