import { micromark } from 'micromark';
import { gfmTable, gfmTableHtml } from 'micromark-extension-gfm-table';
import { parseFactorioRichText } from './factorio-rich-text';

export function renderMarkdown(text: string, serverId?: string) {
	// Model output is untrusted: escape HTML, reject unsafe URLs, and never load remote images.
	const html = micromark(text, {
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
		.replaceAll('</table>', '</table></div>');
	if (!serverId) return html;
	let code = 0;
	// Transform renderer text only: attributes and literal code keep their bytes.
	return html
		.split(/(<[^>]+>)/u)
		.map((part) => {
			if (part.startsWith('<')) {
				if (/^<(?:pre|code)(?:\s|>)/u.test(part)) code++;
				if (/^<\/(?:pre|code)>/u.test(part)) code--;
				return part;
			}
			if (code) return part;
			return part.replace(
				/\[(?:item|fluid|entity|technology|recipe|img)=[^\]\n]{1,256}\]/gu,
				(tag) => {
					const reference = parseFactorioRichText(tag)[0];
					if (reference?.kind !== 'icon') return tag;
					const { kind, name } = reference.prototype;
					const src = `/api/servers/${encodeURIComponent(serverId)}/icons/${kind}/${encodeURIComponent(name)}`;
					return `<span class="factorio-reference" title="${name}"><img src="${src}" alt="" width="20" height="20" loading="lazy" decoding="async" />${reference.caption}</span>`;
				}
			);
		})
		.join('');
}
