<script lang="ts">
 import type { FactoryResult } from '$lib/assistant-results';
 import { presentFactoryResult } from '$lib/factory-results';
 import { consoleLevel, highlightCommand, isLuaLine, tokenClass } from '$lib/console';
 import { FlaskConicalIcon, UsersIcon, ChartNoAxesCombinedIcon, MapPinIcon, ServerIcon, CopyIcon, CheckIcon, ArrowUpRightIcon } from '@lucide/svelte';
 import PrototypeIcon from './PrototypeIcon.svelte';
 import TooltipButton from '$lib/components/ui/button/tooltip-button.svelte';
 let { item, serverId }: { item: FactoryResult; serverId?: string } = $props();
 const view = $derived(presentFactoryResult(item));
 const Icon = $derived(({ research: FlaskConicalIcon, players: UsersIcon, production: ChartNoAxesCombinedIcon, location: MapPinIcon, server: ServerIcon })[view.icon]);
 let expanded = $state(false);
 let copied = $state('');
 let copyError = $state('');
 async function copyGPS(gps: string) { try { await navigator.clipboard.writeText(gps); copied = gps; copyError = ''; } catch { copyError = 'Could not copy location.'; } }
</script>
<section class="overflow-hidden border border-border bg-white/[0.025] text-sm" aria-label={view.title}>
 <header class="flex items-center gap-2 border-b border-border px-3 py-2.5"><Icon class="size-4 shrink-0 text-primary" /><h3 class="font-semibold">{view.title}</h3>{#if view.context}<span class="ml-auto text-right text-xs text-muted-foreground">{view.context}</span>{/if}</header>
 <div class="divide-y divide-border">
  {#each (expanded ? view.cards : view.cards.slice(0,6)) as card}
   <div class="space-y-2.5 px-3 py-3">
    <div class="flex items-start justify-between gap-3"><div class="flex min-w-0 items-center gap-3">{#if card.prototype && serverId}<PrototypeIcon prototype={card.prototype} {serverId} large />{/if}<div class="min-w-0"><h4 class="font-semibold break-words">{card.title}</h4>{#if card.subtitle}<p class="mt-0.5 text-xs text-muted-foreground">{card.subtitle}</p>{/if}</div></div>{#if card.badge}<span class={`shrink-0 px-2 py-0.5 text-xs ${card.tone === 'good' ? 'bg-emerald-400/10 text-emerald-300' : card.tone === 'warning' ? 'bg-amber-400/10 text-amber-300' : 'bg-white/5 text-muted-foreground'}`}>{card.badge}</span>{/if}</div>
    {#if card.metrics.length}<dl class="flex flex-wrap gap-x-7 gap-y-3">{#each card.metrics as metric}<div class={metric.fraction !== undefined ? 'w-full' : 'min-w-16'}><dt class="text-xs text-muted-foreground">{metric.label}</dt><dd class="mt-0.5 font-semibold tabular-nums">{metric.value}</dd>{#if metric.fraction !== undefined}<progress aria-label={metric.label} value={metric.fraction} max="1" class="mt-1 h-1.5 w-full accent-primary"></progress>{/if}</div>{/each}</dl>{/if}
    {#if card.details?.length}<div class="space-y-2 text-xs">{#each card.details as detail}<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5"><span class="text-muted-foreground">{detail.label}</span>{#each detail.entries as entry}<span class="inline-flex items-center gap-1.5">{#if entry.prototype && serverId}<PrototypeIcon prototype={entry.prototype} {serverId} />{/if}<span>{entry.text}</span></span>{/each}</div>{/each}</div>{/if}
    {#if card.notes.length}<ul class="space-y-1 text-xs text-muted-foreground">{#each card.notes as note}<li>{note}</li>{/each}</ul>{/if}
    {#if card.gps}<div class="flex items-center gap-2"><code class="min-w-0 break-all text-xs text-primary">{card.gps}</code><TooltipButton tooltip="Copy map location" variant="ghost" size="sm" onclick={() => copyGPS(card.gps ?? '')}>{#if copied === card.gps}<CheckIcon />{:else}<CopyIcon />{/if}</TooltipButton></div>{/if}
   </div>
  {/each}
 </div>
 {#if view.cards.length > 6}<button type="button" class="w-full border-t px-3 py-2 text-left text-xs text-primary hover:bg-white/5" aria-expanded={expanded} onclick={() => expanded = !expanded}>{expanded ? 'Show fewer' : `Show all ${view.cards.length}`}</button>{/if}
 {#each view.tables as table}
  <div class="border-t border-border px-3 py-3"><h4 class="mb-2 text-xs font-semibold">{table.title}</h4><div class="overflow-x-auto"><table class="w-full text-left text-xs"><thead class="text-muted-foreground"><tr>{#each table.columns as column}<th scope="col" class="border-b border-border px-2 py-1.5 font-medium first:pl-0">{column}</th>{/each}</tr></thead><tbody>{#each (expanded ? table.rows : table.rows.slice(0, 8)) as row, rowIndex}<tr class="border-b border-border/50 last:border-0">{#each row as cell, cellIndex}{@const prototype = table.prototypes?.[rowIndex]?.[cellIndex]}<td class="px-2 py-1.5 tabular-nums first:pl-0"><span class="inline-flex items-center gap-1.5">{#if prototype && serverId}<PrototypeIcon {prototype} {serverId} />{/if}<span>{cell}</span></span></td>{/each}</tr>{/each}</tbody></table></div>{#if table.rows.length > 8}<button type="button" class="mt-2 text-xs text-primary" aria-expanded={expanded} onclick={() => expanded = !expanded}>{expanded ? 'Show fewer' : `Show all ${table.rows.length}`}</button>{/if}</div>
 {/each}
 {#if view.lines.length}<div class="max-h-64 overflow-auto bg-black/25 p-3 font-mono text-xs leading-5">{#each view.lines as line}<div class={`whitespace-pre ${consoleLevel(line) === 'error' ? 'text-red-400' : consoleLevel(line) === 'warning' ? 'text-amber-300' : 'text-muted-foreground'}`}>{#if isLuaLine(line)}{#each highlightCommand(line) as token}<span class={tokenClass(token.kind)}>{token.text}</span>{/each}{:else}{line}{/if}</div>{/each}</div>{/if}
 {#if !view.cards.length && !view.tables.length && !view.lines.length && view.empty}<p class="p-3 text-muted-foreground">{view.empty}</p>{/if}
 {#if view.assumptions.length}<details class="border-t border-border px-3 py-2 text-xs text-muted-foreground"><summary class="cursor-pointer">Calculation</summary><ul class="mt-2 space-y-1">{#each view.assumptions as assumption}<li>{assumption}</li>{/each}</ul></details>{/if}
 {#if view.notes.length}<ul class="space-y-1 border-t border-border px-3 py-2 text-xs text-amber-200">{#each view.notes as note}<li>{note}</li>{/each}</ul>{/if}
 {#if view.link}<a href={view.link.href} class="flex items-center justify-between border-t border-border px-3 py-2.5 text-sm font-medium text-primary hover:bg-white/5">{view.link.label}<ArrowUpRightIcon class="size-4" /></a>{/if}
 {#if copyError}<p role="alert" class="px-3 py-2 text-xs text-destructive">{copyError}</p>{/if}
</section>
