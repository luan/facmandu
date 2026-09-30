import { micromark } from 'micromark';
import { gfmTable, gfmTableHtml } from 'micromark-extension-gfm-table';

export function renderMarkdown(text: string) {
	// Model output is untrusted: escape HTML, reject unsafe URLs, and never load remote images.
	return (
		micromark(text, {
			allowDangerousHtml: false,
			allowDangerousProtocol: false,
			extensions: [gfmTable(), { disable: { null: ['labelStartImage'] } }],
			htmlExtensions: [gfmTableHtml()]
		})
			// These tags come from the renderer; user-supplied HTML remains escaped.
			.replaceAll(
				'<table>',
				'<div class="assistant-table" role="region" aria-label="Table" tabindex="0"><table>'
			)
			.replaceAll('</table>', '</table></div>')
	);
}
