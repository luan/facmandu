<script lang="ts">
 import type { FactoryResult } from '$lib/assistant-results';
 import { presentFactoryResult } from '$lib/factory-results';
 import { consoleLevel, highlightCommand, isLuaLine, tokenClass } from '$lib/console';
 import { FlaskConicalIcon, UsersIcon, ChartNoAxesCombinedIcon, MapPinIcon, ServerIcon, CopyIcon, DownloadIcon, CheckIcon, ArrowUpRightIcon } from '@lucide/svelte';
 import { blueprintArtifactSchema } from '$lib/blueprints';
 import BlueprintResult from './BlueprintResult.svelte';
 import FactoryImage from './FactoryImage.svelte';
 import { factoryViewSchema, factoryPreviewPendingSchema, factoryImageArtifactSchema } from '$lib/factory-images';
 import PrototypeIcon from './PrototypeIcon.svelte';
 import Button from './ui/button/button.svelte';
 import TooltipButton from '$lib/components/ui/button/tooltip-button.svelte';
 let { item, serverId }: { item: FactoryResult; serverId?: string } = $props();
 const renderedImage = $derived(factoryImageArtifactSchema.safeParse(item.result));
 const snapshot = $derived(factoryViewSchema.or(factoryPreviewPendingSchema).safeParse(item.result));
 const blueprint = $derived(blueprintArtifactSchema.safeParse(item.result));
 const view = $derived(presentFactoryResult(item));
 const sharedString = $derived(item.tool === 'fetch_blueprint' && item.result && typeof item.result === 'object' && 'string' in item.result && typeof item.result.string === 'string' && /^0[A-Za-z0-9+/=]+$/.test(item.result.string) && item.result.string.length <= 1024 * 1024 ? item.result.string : '');
 const Icon = $derived(({ research: FlaskConicalIcon, players: UsersIcon, production: ChartNoAxesCombinedIcon, location: MapPinIcon, server: ServerIcon })[view.icon]);
 let expanded = $state(false);
 let copied = $state('');
 let copyError = $state('');
 async function copyLayout() { if (!snapshot.success || !snapshot.data.blueprint) return; try { await navigator.clipboard.writeText(snapshot.data.blueprint); copied = snapshot.data.blueprint; copyError = ''; } catch { copyError = 'Could not copy layout. Download it instead.'; } }
 function downloadLayout() { if (!snapshot.success || !snapshot.data.blueprint) return; const url = URL.createObjectURL(new Blob([snapshot.data.blueprint], {type: 'text/plain'})); const link = document.createElement('a'); link.href = url; link.download = 'factory-layout.txt'; link.click(); URL.revokeObjectURL(url); }
 async function copyValue(value: string, failure: string) { try { await navigator.clipboard.writeText(value); copied = value; copyError = ''; } catch { copyError = failure; } }
</script>
{#if blueprint.success}
<BlueprintResult blueprint={blueprint.data} {serverId} />
{:else if renderedImage.success && serverId}
<section class="overflow-hidden border border-border bg-white/[0.025] text-sm" aria-label={renderedImage.data.label}><header class="p-3"><h3 class="font-semibold">Blueprint preview · {renderedImage.data.label}</h3></header><FactoryImage image={renderedImage.data.image} {serverId} label={renderedImage.data.label} /><p class="p-3 text-xs text-muted-foreground">Preview only; placement and throughput are not verified.</p>{#if renderedImage.data.blueprint || renderedImage.data.source}<div class="flex items-center gap-3 px-3 pb-3">{#if renderedImage.data.blueprint}<Button size="sm" variant="outline" onclick={() => copyValue(renderedImage.data.blueprint ?? '', 'Could not copy blueprint.')}>{#if copied === renderedImage.data.blueprint}<CheckIcon />{:else}<CopyIcon />{/if}Copy blueprint</Button>{/if}{#if renderedImage.data.source}<a href={renderedImage.data.source} target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-xs text-primary">Open source<ArrowUpRightIcon class="size-3.5" /></a>{/if}</div>{/if}{#if copyError}<p role="alert" class="px-3 pb-3 text-xs text-destructive">{copyError}</p>{/if}</section>
{:else if snapshot.success && serverId}
<section class="overflow-hidden border border-border bg-white/[0.025] text-sm" aria-label="Factory view"><header class="flex flex-wrap items-center justify-between gap-2 p-3"><h3 class="font-semibold">Existing factory · {snapshot.data.surface}</h3><span class="text-xs text-muted-foreground">{snapshot.data.count} entities · Tick {snapshot.data.tick}</span></header><FactoryImage image={snapshot.data.image} {serverId} label={`Factory on ${snapshot.data.surface} at tick ${snapshot.data.tick}`} /><p class="p-3 text-xs text-muted-foreground">World area ({snapshot.data.area.left_top.x}, {snapshot.data.area.left_top.y}) to ({snapshot.data.area.right_bottom.x}, {snapshot.data.area.right_bottom.y}). {#if snapshot.data.origin.x !== 0 || snapshot.data.origin.y !== 0}Add ({snapshot.data.origin.x}, {snapshot.data.origin.y}) to grid coordinates for world positions. {/if}Existing layout; belt items and machine status are not shown.</p>{#if snapshot.data.blueprint}<div class="flex gap-2 px-3 pb-3"><Button size="sm" onclick={() => void copyLayout()}>{#if copied === snapshot.data.blueprint}<CheckIcon />{:else}<CopyIcon />{/if}Copy current layout</Button><Button size="sm" variant="outline" onclick={downloadLayout}><DownloadIcon />Download layout</Button></div>{/if}{#if copyError}<p role="alert" class="px-3 pb-3 text-xs text-destructive">{copyError}</p>{/if}</section>
{:else}
<section class="overflow-hidden border border-border bg-white/[0.025] text-sm" aria-label={view.title}>
 <header class="flex items-center gap-2 border-b border-border px-3 py-2.5"><Icon class="size-4 shrink-0 text-primary" /><h3 class="font-semibold">{view.title}</h3>{#if view.context}<span class="ml-auto text-right text-xs text-muted-foreground">{view.context}</span>{/if}</header>
 <div class="divide-y divide-border">
  {#each (expanded ? view.cards : view.cards.slice(0,6)) as card}
   <div class="space-y-2.5 px-3 py-3">
    <div class="flex items-start justify-between gap-3"><div class="flex min-w-0 items-center gap-3">{#if card.prototype && serverId}<PrototypeIcon prototype={card.prototype} {serverId} large />{/if}<div class="min-w-0"><h4 class="font-semibold break-words">{card.title}</h4>{#if card.subtitle}<p class="mt-0.5 text-xs text-muted-foreground">{card.subtitle}</p>{/if}</div></div>{#if card.badge}<span class={`shrink-0 px-2 py-0.5 text-xs ${card.tone === 'good' ? 'bg-emerald-400/10 text-emerald-300' : card.tone === 'warning' ? 'bg-amber-400/10 text-amber-300' : 'bg-white/5 text-muted-foreground'}`}>{card.badge}</span>{/if}</div>
    {#if card.metrics.length}<dl class="flex flex-wrap gap-x-7 gap-y-3">{#each card.metrics as metric}<div class={metric.fraction !== undefined ? 'w-full' : 'min-w-16'}><dt class="text-xs text-muted-foreground">{metric.label}</dt><dd class="mt-0.5 font-semibold tabular-nums">{metric.value}</dd>{#if metric.fraction !== undefined}<progress aria-label={metric.label} value={metric.fraction} max="1" class="mt-1 h-1.5 w-full accent-primary"></progress>{/if}</div>{/each}</dl>{/if}
    {#if card.details?.length}<div class="space-y-2 text-xs">{#each card.details as detail}{#if card.badge === 'Choose recipe' || card.badge === 'Choose machine'}<details><summary class="cursor-pointer text-muted-foreground">{detail.entries.length} {detail.label.toLowerCase()}</summary><ul class="mt-2 grid gap-2 sm:grid-cols-2">{#each detail.entries as entry}<li class="inline-flex items-center gap-1.5">{#if entry.prototype && serverId}<PrototypeIcon prototype={entry.prototype} {serverId} />{/if}<span>{entry.text}</span></li>{/each}</ul></details>{:else}<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5"><span class="text-muted-foreground">{detail.label}</span>{#each detail.entries as entry}<span class="inline-flex items-center gap-1.5">{#if entry.prototype && serverId}<PrototypeIcon prototype={entry.prototype} {serverId} />{/if}<span>{entry.text}</span></span>{/each}</div>{/if}{/each}</div>{/if}
    {#if card.notes.length}<ul class="space-y-1 text-xs text-muted-foreground">{#each card.notes as note}<li>{note}</li>{/each}</ul>{/if}
    {#if card.link}<a href={card.link.href} target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-xs text-primary">{card.link.label}<ArrowUpRightIcon class="size-3.5" /></a>{/if}
    {#if card.gps}<div class="flex items-center gap-2"><code class="min-w-0 break-all text-xs text-primary">{card.gps}</code><TooltipButton tooltip="Copy map location" variant="ghost" size="sm" onclick={() => copyValue(card.gps ?? '', 'Could not copy location.')}>{#if copied === card.gps}<CheckIcon />{:else}<CopyIcon />{/if}</TooltipButton></div>{/if}
   </div>
  {/each}
 </div>
 {#if view.cards.length > 6}<button type="button" class="w-full border-t px-3 py-2 text-left text-xs text-primary hover:bg-white/5" aria-expanded={expanded} onclick={() => expanded = !expanded}>{expanded ? 'Show fewer' : `Show all ${view.cards.length}`}</button>{/if}
 {#each view.tables as table}
  {@const previewCount = table.previewCount ?? 8}
  <div class="border-t border-border px-3 py-3"><h4 class="mb-2 text-xs font-semibold">{table.title}</h4><div class="overflow-x-auto"><table class="w-full text-left text-xs"><thead class="text-muted-foreground"><tr>{#each table.columns as column}<th scope="col" class="border-b border-border px-2 py-1.5 font-medium first:pl-0">{column}</th>{/each}</tr></thead><tbody>{#each (expanded ? table.rows : table.rows.slice(0, previewCount)) as row, rowIndex}<tr class="border-b border-border/50 last:border-0">{#each row as cell, cellIndex}{@const prototype = table.prototypes?.[rowIndex]?.[cellIndex]}<td class="px-2 py-1.5 tabular-nums first:pl-0"><span class="inline-flex items-center gap-1.5">{#if prototype && serverId}<PrototypeIcon {prototype} {serverId} />{/if}<span>{cell}</span></span></td>{/each}</tr>{/each}</tbody></table></div>{#if table.rows.length > previewCount}<button type="button" class="mt-2 text-xs text-primary" aria-expanded={expanded} onclick={() => expanded = !expanded}>{expanded ? 'Show fewer' : `Show all ${table.rows.length}`}</button>{/if}</div>
 {/each}
 {#if view.lines.length}<div class="max-h-64 overflow-auto bg-black/25 p-3 font-mono text-xs leading-5">{#each view.lines as line}<div class={`whitespace-pre ${consoleLevel(line) === 'error' ? 'text-red-400' : consoleLevel(line) === 'warning' ? 'text-amber-300' : 'text-muted-foreground'}`}>{#if isLuaLine(line)}{#each highlightCommand(line) as token}<span class={tokenClass(token.kind)}>{token.text}</span>{/each}{:else}{line}{/if}</div>{/each}</div>{/if}
 {#if !view.cards.length && !view.tables.length && !view.lines.length && view.empty}<p class="p-3 text-muted-foreground">{view.empty}</p>{/if}
 {#if view.assumptions.length}<details class="border-t border-border px-3 py-2 text-xs text-muted-foreground"><summary class="cursor-pointer">Calculation</summary><ul class="mt-2 space-y-1">{#each view.assumptions as assumption}<li>{assumption}</li>{/each}</ul></details>{/if}
 {#if view.notes.length}<ul class="space-y-1 border-t border-border px-3 py-2 text-xs text-amber-200">{#each view.notes as note}<li>{note}</li>{/each}</ul>{/if}
 {#if view.reference}<div class="flex items-center justify-between gap-2 border-t border-border px-3 py-2.5"><code class="break-all text-xs text-primary">{view.reference}</code><Button size="sm" variant="outline" onclick={() => copyValue(view.reference ?? '', 'Could not copy plan reference.')}>{#if copied === view.reference}<CheckIcon />{:else}<CopyIcon />{/if}Copy plan reference</Button></div>{/if}
 {#if sharedString}<div class="border-t border-border px-3 py-2.5"><Button size="sm" variant="outline" onclick={() => copyValue(sharedString, 'Could not copy blueprint.')}>{#if copied === sharedString}<CheckIcon />{:else}<CopyIcon />{/if}Copy blueprint</Button></div>{/if}
 {#if view.link}<a href={view.link.href} class="flex items-center justify-between border-t border-border px-3 py-2.5 text-sm font-medium text-primary hover:bg-white/5">{view.link.label}<ArrowUpRightIcon class="size-4" /></a>{/if}
 {#if copyError}<p role="alert" class="px-3 py-2 text-xs text-destructive">{copyError}</p>{/if}
</section>

{/if}
