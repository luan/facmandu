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
