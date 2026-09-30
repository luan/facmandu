<script lang="ts">
 import { renderMarkdown } from '$lib/markdown';
 let { text }: { text: string } = $props();
 const html = $derived(renderMarkdown(text));
</script>
<div class="assistant-markdown text-sm leading-relaxed">{@html html}</div>
<style>
 .assistant-markdown { overflow-wrap: anywhere; }
 .assistant-markdown > :global(:first-child) { margin-top: 0; }
 .assistant-markdown > :global(:last-child) { margin-bottom: 0; }
 .assistant-markdown :global(p), .assistant-markdown :global(ul), .assistant-markdown :global(ol), .assistant-markdown :global(pre), .assistant-markdown :global(blockquote) { margin-block: .75rem; }
 .assistant-markdown :global(ul) { list-style: disc; padding-left: 1.3rem; }
 .assistant-markdown :global(ol) { list-style: decimal; padding-left: 1.3rem; }
 .assistant-markdown :global(li + li) { margin-top: .35rem; }
 .assistant-markdown :global(li > p) { margin-block: .35rem; }
 .assistant-markdown :global(h1), .assistant-markdown :global(h2), .assistant-markdown :global(h3), .assistant-markdown :global(h4) { font-size: 1rem; font-weight: 600; margin: 1rem 0 .5rem; }
 .assistant-markdown :global(strong) { font-weight: 600; color: var(--foreground); }
 .assistant-markdown :global(a) { color: var(--primary); text-decoration: underline; text-underline-offset: 2px; }
 .assistant-markdown :global(code) { font-family: monospace; font-size: .9em; background: #0003; padding: .1rem .25rem; }
 .assistant-markdown :global(pre) { overflow-x: auto; background: #0003; padding: .75rem; }
 .assistant-markdown :global(pre code) { padding: 0; background: none; }
 .assistant-markdown :global(blockquote) { border-left: 2px solid var(--primary); padding-left: .75rem; color: var(--muted-foreground); }
 .assistant-markdown :global(.assistant-table) { max-width: 100%; overflow-x: auto; margin-block: .75rem; }
 .assistant-markdown :global(.assistant-table:focus-visible) { outline: 2px solid var(--primary); outline-offset: 2px; }
 .assistant-markdown :global(table) { width: 100%; border-collapse: collapse; font-size: .875rem; }
 .assistant-markdown :global(th), .assistant-markdown :global(td) { min-width: 9rem; padding: .625rem .75rem; border-bottom: 1px solid var(--border); vertical-align: top; }
 .assistant-markdown :global(th) { font-weight: 600; background: #ffffff08; }
 .assistant-markdown :global(th:not([align])), .assistant-markdown :global(td:not([align])) { text-align: left; }
</style>
