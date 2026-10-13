// Titles are plain labels, never model instructions or Factorio rich-text markup.
export function assistantTitle(text: string): string | null {
	const title = text
		.trim()
		.replace(/^(["'])|(["'])$/gu, '')
		.replace(/\s+/gu, ' ');
	if (!title || title.length > 72 || /[[\]{}<>`\n\r]/u.test(text)) return null;
	return title;
}
