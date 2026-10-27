<script lang="ts">
 import { untrack } from 'svelte';
 import { enhance } from '$app/forms';
 import type { SubmitFunction } from '$app/forms';
 import { SaveIcon } from '@lucide/svelte';
 import * as Card from '#lib/components/ui/card/index.js';
 import TooltipButton from '#lib/components/ui/button/tooltip-button.svelte';
 import type { ServerView } from '#lib/server/server-view.js';
 let { config, models, action, submit, busyReason }: { config: NonNullable<ServerView['gameAssistant']>; models: ServerView['gameModels']; action: string; submit: SubmitFunction; busyReason: string } = $props();
 let enabled = $state(untrack(() => config.enabled));
 let model = $state(untrack(() => config.model || models.find((item) => item.id.includes('luna'))?.id || models[0]?.id || ''));
 let effort = $state(untrack(() => config.effort || models.find((item) => item.id === model)?.defaultEffort || ''));
 let chatMode = $state(untrack(() => config.chatMode));
 let actions = $state(untrack(() => config.actions));
 let players = $state(untrack(() => config.players.join('\n')));
 const selected = $derived(models.find((item) => item.id === model));
 const input = 'min-w-0 w-full border border-input bg-background px-3 py-2 text-sm';
 function chooseModel(event: Event & { currentTarget: HTMLSelectElement }) { effort = models.find((item) => item.id === event.currentTarget.value)?.defaultEffort ?? ''; }
</script>
<Card.Root>
 <Card.Header><Card.Title>Toby in game</Card.Title><Card.Description>Players can ask with @. Replies go to their force; transcripts appear in your server assistant.</Card.Description></Card.Header>
 <Card.Content>
  <form method="POST" {action} use:enhance={submit} class="space-y-4">
   <input type="hidden" name="operation" value="gameAssistant" />
   <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" bind:checked={enabled} />Enable for this server</label>
   <div class="grid gap-4 sm:grid-cols-2">
    <label class="grid gap-2 text-sm">Model<select name="model" class={input} bind:value={model} onchange={chooseModel} disabled={!models.length}>{#each models as item}<option value={item.id}>{item.name}</option>{/each}</select></label>
    <label class="grid gap-2 text-sm">Effort<select name="effort" class={input} bind:value={effort} disabled={!selected?.efforts.length}>{#each selected?.efforts ?? [] as level}<option value={level}>{({ minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' } as Record<string, string>)[level] ?? level}</option>{/each}</select></label>
   </div>
   <label class="grid gap-2 text-sm">Chat activation<select name="chatMode" class={input} bind:value={chatMode}><option value="mentions">Only messages starting with @</option><option value="ambient">Ambient · Clef routes ordinary chat</option></select></label>
   {#if chatMode === 'ambient'}<p class="text-xs text-muted-foreground">Ordinary player chat and recent assistant context are sent to your NeuralWatt account for routing. Game changes still require an explicit request and follow the Factory actions permissions. Uncertain messages are ignored.</p>{/if}
   <label class="grid gap-2 text-sm">Factory actions<select name="actions" class={input} bind:value={actions}><option value="off">Questions only</option><option value="admins">Factorio administrators</option><option value="allowlist">Selected players</option></select></label>
   {#if actions === 'allowlist'}<label class="grid gap-2 text-sm">Allowed player names<textarea name="players" class={input} rows="3" bind:value={players} placeholder="One Factorio player name per line"></textarea></label>{:else}<input name="players" type="hidden" value={players} />{/if}
   <p class="text-xs text-muted-foreground">Uses your connected model account. Actions affect only the player's force; server administration is unavailable. Players can start fresh with @ new chat.</p>
   {#if !models.length}<p class="text-sm text-muted-foreground">Connect a model provider in <a href="/settings" class="underline">Account settings</a> to enable in-game replies.</p>{/if}
   <TooltipButton type="submit" tooltip={busyReason || (enabled && !models.length ? 'Connect a model provider first' : 'Save in-game assistant settings')} disabled={!!busyReason || (enabled && !models.length)}><SaveIcon class="size-4" />Save</TooltipButton>
  </form>
 </Card.Content>
</Card.Root>
