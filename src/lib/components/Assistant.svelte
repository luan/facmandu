<script lang="ts">
 import TooltipButton from '$lib/components/ui/button/tooltip-button.svelte';
 import Prompt from '$lib/components/Prompt.svelte';
 import { AssistantVoice, idleVoice } from '$lib/assistant-voice';
 import FactoryResultView from '$lib/components/FactoryResult.svelte';
 import { serverAssistantPlanSchema, type FactoryResult, type AssistantMod } from '$lib/assistant-results';
 import { modThumbnailUrl } from '$lib/utils';
 import ModPreviewSheet from '../../routes/(app)/modlists/[id]/ModPreviewSheet.svelte';
 import AssistantMessage from '$lib/components/AssistantMessage.svelte';
 import { onDestroy, onMount, tick, untrack } from 'svelte';
 import { invalidate } from '$app/navigation';
 import { RefreshCwIcon, MessageSquareIcon, CheckIcon, LoaderCircleIcon, PackageIcon, PlusIcon, XIcon, ChevronRightIcon, MicIcon, MicOffIcon, PhoneOffIcon } from '@lucide/svelte';
 import { Button, buttonVariants } from '$lib/components/ui/button';
 import * as Sheet from '$lib/components/ui/sheet';
 let { listId, serverId }: { listId?: string; serverId?: string } = $props();
 let activeResults = $state<FactoryResult[]>([]);
 let chat = $state('');
 let chats = $state<{ id: string; title: string; updatedAt: string; compactedAt: string | null }[]>([]);
 let hasMore = $state(false);
 let olderLoading = $state(false);
 let compacted = $state(false);
 async function selectChat(id: string) {
  if (inProgress) return;
  voice.stop();
  chat = id; turns = []; plans = []; combineablePlanIds = []; selectedMods = []; selectedTurn = ''; prompt = ''; error = ''; refreshError = ''; text = ''; activePrompt = ''; activeMods = []; activeResults = []; loading = true;
  await refresh(true, true);
 }
 async function createChat() {
  if (inProgress || loading) return;
  loading = true;
  try {
   const response = await fetch(endpoint, { method: 'POST', body: new URLSearchParams({ operation: 'new-chat' }) });
   if (!response.ok) throw new Error('Could not create chat. Retry.');
   const created = await response.json(); const selected = { model, effort }; await selectChat(created.id); model = selected.model; effort = selected.effort;
  } catch (cause) { error = cause instanceof Error ? cause.message : 'Could not create chat'; }
  finally { loading = false; }
 }
 async function loadOlder() {
  olderLoading = true;
  const selectedChat = chat;
  const height = feed?.scrollHeight ?? 0;
  try {
   const response = await fetch(`${endpoint}?chat=${encodeURIComponent(chat)}&offset=${turns.length}&models=0`, { signal: AbortSignal.timeout(15_000) });
   if (!response.ok) throw new Error('Could not load earlier messages. Retry.');
   const data = await response.json(); if (chat !== selectedChat) return; followOutput = false; turns = [...data.turns, ...turns]; hasMore = data.hasMore;
   await tick(); if (feed) feed.scrollTop += feed.scrollHeight - height;
  } catch (cause) { error = cause instanceof Error ? cause.message : 'Could not load earlier messages'; }
  finally { olderLoading = false; }
 }

 let voiceState = $state({ ...idleVoice });
 const voice = new AssistantVoice({ change: state => voiceState = state, request: ask });
 $effect(() => { listId; serverId; if (!open) voice.stop(); return () => voice.stop(); });
 let open = $state(false); let prompt = $state(''); let busy = $state(false); let progress = $state(''); let text = $state(''); let error = $state(''); let refreshError = $state('');
 let turns = $state<{ id: string; prompt: string; answer: string; state: string; mods: AssistantMod[]; results?: FactoryResult[]; plans?: ModlistPlan[] }[]>([]);
  const inProgress = $derived(busy || turns.some(turn => turn.state === 'running'));
 type ModlistPlan = {
  id: string;
  applied: boolean;
  stale: boolean;
  refreshable: boolean;
  changes: string[];
  details: { name: string; title: string; action: 'add' | 'remove' | 'enable' | 'disable' | 'icebox' | 'update' | 'lock' | 'unlock'; version: string | null; dependency: boolean; requiredBy?: string[] }[];
 };
 const planActionLabels = { add: 'Add', remove: 'Remove', enable: 'Enable', disable: 'Disable', icebox: 'Icebox', update: 'Update', lock: 'Lock', unlock: 'Unlock' } as const;
 let plans = $state<ModlistPlan[]>([]);
 let combineablePlanIds = $state<string[]>([]);
 let selectedMods = $state<string[]>([]);
 let selectedTurn = $state('');
 let controller = $state<AbortController>();
 let activePrompt = $state('');
 let activeMods = $state<AssistantMod[]>([]);
 let previewName = $state<string | null>(null);
 let previewOpen = $state(false);
 let models = $state<{ id: string; name: string; efforts: string[]; defaultEffort: string }[]>([]);
 let model = $state('');
 let effort = $state('');
 const effortChoices = $derived(models.find(item => item.id === model)?.efforts ?? []);
 $effect(() => { if (!effortChoices.includes(effort)) effort = models.find(item => item.id === model)?.defaultEffort ?? ''; });
 let modelError = $state('');
 let modelCatalogLoaded = false;
 let loading = $state(true);
 let feed = $state<HTMLDivElement>();
 let followOutput = $state(true);
 let pollTimer: ReturnType<typeof setTimeout> | undefined;
 const endpoint = $derived(serverId ? `/servers/${serverId}/assistant` : `/api/modlists/${listId}/assistant`);
 const unavailableSetups = new Set<string>();
 function setupId(item: FactoryResult, status: 'running' | 'failed'): string | undefined {
  const result = item.result;
  if (result && typeof result === 'object' && 'kind' in result && result.kind === 'server_setup' && 'status' in result && result.status === status && 'serverId' in result && typeof result.serverId === 'string') return result.serverId;
  return undefined;
 }
 $effect(() => {
  const ids = [...new Set([...activeResults, ...turns.flatMap(turn => turn.results ?? [])].flatMap(item => setupId(item, 'running') ?? []))];
  if (!open || serverId || !ids.length) return;
  const selectedChat = chat;
  const url = endpoint;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  async function poll() {
   const updates = new Map<string, unknown>();
   for (const id of ids) {
    if (unavailableSetups.has(id)) continue;
    try {
     const response = await fetch(`${url}?chat=${encodeURIComponent(selectedChat)}&setup=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15_000) });
     if (response.status === 403 || (response.status === 404 && !busy)) unavailableSetups.add(id);
     if (!response.ok) continue;
     const result: unknown = await response.json();
     if (stopped) return;
     updates.set(id, result);
    } catch { /* Keep the last known stage and retry transient connection failures. */ }
   }
   if (stopped) return;
   if (updates.size) {
    const update = (item: FactoryResult) => { const id = setupId(item, 'running'); return id && updates.has(id) ? { ...item, result: updates.get(id) } : item; };
    activeResults = activeResults.map(update);
    turns = turns.map(turn => ({ ...turn, results: turn.results?.map(update) }));
   }
   if (ids.some(id => !unavailableSetups.has(id))) timer = setTimeout(poll, 2500);
  }
  timer = setTimeout(poll, 1500);
  return () => { stopped = true; clearTimeout(timer); };
 });
 async function refresh(resetModel = false, reloadModels = false): Promise<boolean> {
  const selectedChat = chat;
  const query = new URLSearchParams();
  if (chat) query.set('chat', chat);
  if (!reloadModels && modelCatalogLoaded) query.set('models', '0');
  try {
   const response = await fetch(`${endpoint}${query.size ? `?${query}` : ''}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
   const data = await response.json();
   if (!response.ok) throw new Error(data.message);
   if (selectedChat && chat !== selectedChat) return false;
   chat = data.chat.id; chats = data.chats; hasMore = data.hasMore; compacted = Boolean(data.chat.compactedAt); turns = data.turns;
   plans = data.plans; combineablePlanIds = data.combineablePlanIds ?? [];
   if (data.models) { models = data.models; modelError = data.modelError; modelCatalogLoaded = true; }
   if (resetModel || !model || (data.models && !models.some(item => item.id === model))) model = models.some(item => item.id === data.model) ? data.model : models[0]?.id ?? '';
   if (resetModel || !effort) effort = data.effort;
   if (turns.at(-1)?.answer === error || (activePrompt && turns.at(-1)?.prompt === activePrompt && turns.at(-1)?.state === 'done')) error = '';
   if (activePrompt && turns.at(-1)?.prompt === activePrompt && turns.at(-1)?.state !== 'running') { text = ''; activePrompt = ''; activeMods = []; activeResults = []; }
   refreshError = '';
   return true;
  } catch {
   refreshError = 'Could not refresh conversation.';
   return false;
  } finally {
   loading = false;
   clearTimeout(pollTimer);
   if (open && !busy && (turns.some(turn => turn.state === 'running') || (activePrompt && refreshError))) pollTimer = setTimeout(() => void refresh(), 1500);
  }
 }
 $effect(() => { if (open) { followOutput = true; void untrack(() => refresh(false, !modelCatalogLoaded)); } });
 $effect(() => {
  turns; plans; text; progress; activePrompt;
  if (feed && followOutput) void tick().then(() => { if (feed && followOutput) feed.scrollTop = feed.scrollHeight; });
 });

 async function explain(event: Event) {
  if (!(event instanceof CustomEvent) || typeof event.detail !== 'string') return;
  open = true; prompt = `Why would ${event.detail} be useful in this list? Explain what it adds, overlaps with enabled mods, and compatibility or dependency concerns.`;
  await refresh(); void send();
 }
 async function send() {
  if (inProgress || loading || !prompt.trim()) return;
  const message = prompt; prompt = '';
  try { await ask(message); } catch { if (!prompt) prompt = message; }
 }
 async function ask(message: string): Promise<string> {
  if (inProgress || loading) throw new Error('The assistant is still working. Wait for its response, then ask again.');
  followOutput = true; busy = true; error = ''; text = ''; activeMods = []; activeResults = []; progress = 'Reading request…'; controller = new AbortController();
  const previousPlanId = plans[0]?.id;
  activePrompt = message;
  const requestController = controller;
  let accepted = false;
  try {
   const response = await fetch(endpoint, { method: 'POST', headers: { Accept: 'application/json' }, body: new URLSearchParams({ chat, prompt: message, model, effort }), signal: controller.signal });
   if (!response.ok) { const data = await response.json(); throw new Error(data.message ?? 'Could not send message'); }
   accepted = true;
   const reader = response.body?.getReader(); if (!reader) throw new Error('No response stream');

   const decoder = new TextDecoder(); let buffer = '';
   for (;;) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) { const event = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); if (event.compacted) compacted = true; if (event.results) activeResults = event.results; if (event.mods) activeMods = event.mods; if (event.delta) text += event.delta; if (event.progress) progress = event.progress; if (event.answer) text = event.answer; if (event.error) error = event.error; newline = buffer.indexOf('\n'); }
   }
   if (error) throw new Error(error);
   return text;
  } catch (cause) { error = requestController.signal.aborted ? 'Stopped' : cause instanceof SyntaxError ? 'The response was interrupted. Retry.' : cause instanceof Error ? cause.message : 'Request failed'; throw new Error(error); }
  finally { busy = false; controller = undefined; progress = ''; if (!accepted) { text = ''; activePrompt = ''; activeMods = []; activeResults = []; } await refresh(); if (!serverId && plans[0]?.applied && plans[0].id !== previousPlanId) await invalidate('app:modlist'); }
 }
 async function apply(id: string) {
  busy = true; error = ''; progress = 'Applying changes…';
  try { const response = await fetch(endpoint, { method: 'POST', headers: { Accept: 'application/json' }, body: new URLSearchParams({ chat, operation: 'apply', plan: id }) }); const data = await response.json(); if (!response.ok) throw new Error(data.message); await invalidate('app:modlist'); await refresh(); }
  catch (cause) { await refresh(); if (!turns.some(turn => turn.plans?.some(plan => plan.id === id && plan.stale))) error = cause instanceof SyntaxError ? 'Could not confirm these changes. Refresh the conversation before retrying.' : cause instanceof Error ? cause.message : 'Could not apply changes'; }
  finally { busy = false; progress = ''; }
 }
 async function applyServerPlan(turnId: string, hash: string) {
  busy = true; error = ''; progress = 'Applying mod list…';
  try {
   const response = await fetch(endpoint, { method: 'POST', body: new URLSearchParams({ chat, operation: 'apply-modlist', turn: turnId, hash }) });
   const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Could not apply mod list');
   await refresh(); await invalidate('app:server');
  } catch (cause) { error = cause instanceof Error ? cause.message : 'Could not apply mod list'; }
  finally { busy = false; progress = ''; }
 }
 async function retrySetup(id: string) {
  busy = true; error = ''; progress = 'Retrying server setup…';
  try {
   const response = await fetch(endpoint, { method: 'POST', body: new URLSearchParams({ chat, operation: 'retry-server-setup', setup: id }) });
   const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Could not retry setup');
   await refresh();
  } catch (cause) { error = cause instanceof Error ? cause.message : 'Could not retry setup'; }
  finally { busy = false; progress = ''; }
 }
 async function reviewSelected() {
  if (!selectedMods.length || inProgress) return;
  busy = true; error = ''; progress = 'Checking changes and dependencies…'; followOutput = true;
  try { const response = await fetch(endpoint, { method: 'POST', headers: { Accept: 'application/json' }, body: new URLSearchParams({ chat, operation: 'prepare', names: JSON.stringify(selectedMods), turn: selectedTurn }) }); const data = await response.json(); if (!response.ok) throw new Error(data.message); selectedMods = []; await refresh(); }
  catch (cause) { error = cause instanceof SyntaxError ? 'Could not prepare changes. Retry.' : cause instanceof Error ? cause.message : 'Could not prepare changes'; }
  finally { busy = false; progress = ''; }
 }
 async function refreshPlan(id: string) {
  busy = true; error = ''; progress = 'Checking current list…';
  try { const response = await fetch(endpoint, { method: 'POST', headers: { Accept: 'application/json' }, body: new URLSearchParams({ chat, operation: 'refresh', plan: id }) }); const data = await response.json(); if (!response.ok) throw new Error(data.message); await refresh(); }
  catch (cause) { error = cause instanceof SyntaxError ? 'Could not refresh this review. Retry.' : cause instanceof Error ? cause.message : 'Could not refresh review'; }
  finally { busy = false; progress = ''; }
 }
 async function combineReviews() {
  if (combineablePlanIds.length < 2 || inProgress) return;
  busy = true; error = ''; progress = 'Combining reviews…'; followOutput = true;
  try {
   const response = await fetch(endpoint, { method: 'POST', headers: { Accept: 'application/json' }, body: new URLSearchParams({ chat, operation: 'combine', plans: JSON.stringify(combineablePlanIds) }) });
   const data = await response.json();
   if (!response.ok) throw new Error(data.message ?? 'Could not combine reviews');
   selectedMods = [];
   await refresh();
  } catch (cause) { error = cause instanceof Error ? cause.message : 'Could not combine reviews'; }
  finally { busy = false; progress = ''; }
 }
 function toggleSelected(name: string, turnId: string) { selectedMods = selectedMods.includes(name) ? selectedMods.filter(item => item !== name) : [...selectedMods, name]; selectedTurn = turnId; }
 async function stop() { controller?.abort(); await fetch(endpoint, { method: 'POST', headers: { Accept: 'application/json' }, body: new URLSearchParams({ chat, operation: 'cancel' }) }); }
 onMount(() => { if (serverId) return; window.addEventListener('facmandu-explain', explain); return () => window.removeEventListener('facmandu-explain', explain); });
 onDestroy(() => { voice.stop(); controller?.abort(); clearTimeout(pollTimer); });
</script>
{#snippet planRows(plan: ModlistPlan)}
      <div class="divide-y divide-border/60">
       {#if plan.details?.length}
        {#each plan.details as change (`${change.name}:${change.action}`)}
         <div class="flex items-baseline gap-2 px-4 py-2.5 text-sm">
          <span class="w-14 shrink-0 text-xs text-muted-foreground">{planActionLabels[change.action]}</span>
          <div class="min-w-0 flex-1"><span class="font-medium">{change.title}</span>{#if change.requiredBy?.length}<p class="text-xs text-muted-foreground">Required by {change.requiredBy.join(', ')}</p>{/if}</div>
          {#if change.version}<span class="shrink-0 text-xs tabular-nums text-muted-foreground">{change.version}</span>{/if}
         </div>
        {/each}
       {:else}
        {#each plan.changes as change}<div class="px-4 py-2.5 text-sm">{change}</div>{/each}
       {/if}
      </div>
{/snippet}
{#snippet planReceipt(plan: ModlistPlan)}
 {#if plan.applied}
  <details class="group border border-border bg-white/5" aria-label="Applied changes">
   <summary class="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
    <CheckIcon class="size-4 shrink-0 text-primary" />
    <span>{plan.details?.length || plan.changes.length} {(plan.details?.length || plan.changes.length) === 1 ? 'change applied' : 'changes applied'}</span>
    <ChevronRightIcon class="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-90" />
   </summary>
   {@render planRows(plan)}
  </details>
 {:else}
     <section class="border border-border bg-white/5" aria-label="Mod list review">
      <div class="flex items-center gap-2 border-b border-border px-4 py-3">
       <CheckIcon class="size-4 shrink-0 text-primary" />
       <h3 class="font-semibold">Review changes</h3>
       <span class="ml-auto text-xs text-muted-foreground">{plan.details?.length || plan.changes.length} {(plan.details?.length || plan.changes.length) === 1 ? 'change' : 'changes'}</span>
      </div>
      {@render planRows(plan)}
       <div class="flex items-center justify-end gap-3 border-t border-border px-4 py-3">
        {#if plan.stale}<span class="mr-auto text-xs text-muted-foreground">{plan.refreshable ? 'This review is out of date.' : 'This older review is out of date. Select the mods again.'}</span>{#if plan.refreshable}<Button variant="outline" size="sm" disabled={inProgress} onclick={() => refreshPlan(plan.id)}><RefreshCwIcon class="size-4" />Refresh review</Button>{/if}
        {:else}<TooltipButton tooltip={inProgress ? 'Response in progress' : 'Apply all reviewed changes together'} size="sm" disabled={inProgress} onclick={() => apply(plan.id)}><CheckIcon />Apply changes</TooltipButton>{/if}
       </div>
     </section>
 {/if}
{/snippet}
{#snippet modCards(items: AssistantMod[], turnId = '')}
 {#if items.length}<div class="grid gap-3">
  {#each items as item (item.name)}
   <section class="border border-border bg-white/5 p-3 space-y-3">
    <div class="flex gap-3">
     <button type="button" class="shrink-0 size-16 bg-black/20 flex items-center justify-center" aria-label={`View ${item.title}`} onclick={() => { previewName = item.name; previewOpen = true; }}>
      {#if item.thumbnail}<img src={modThumbnailUrl(item.thumbnail)} alt="" class="size-full object-contain" loading="lazy" />{:else}<PackageIcon class="size-7 text-muted-foreground" />{/if}
     </button>
     <div class="min-w-0 space-y-1"><div class="flex flex-wrap items-baseline gap-x-3 gap-y-1"><button type="button" class="font-semibold text-primary text-left hover:underline" onclick={() => { previewName = item.name; previewOpen = true; }}>{item.title}</button><span class="text-xs text-muted-foreground">{item.version ? `v${item.version} · Factorio ${item.factorioVersion}` : `No release for Factorio ${item.factorioVersion}`}</span></div><p class="text-sm text-muted-foreground">{item.summary}</p></div>
    </div>
    <p class="border-l-2 border-primary/50 pl-3 text-sm leading-relaxed">{item.reason}</p>
    <div class="flex justify-end items-center gap-2">
     {#if item.enabled}<span class="inline-flex items-center gap-1 text-xs text-muted-foreground"><CheckIcon class="size-3.5" />Enabled</span>{:else}<TooltipButton tooltip={inProgress ? 'Response in progress' : !item.version ? `No release for Factorio ${item.factorioVersion}` : selectedMods.includes(item.name) ? 'Remove from review' : 'Select for one combined review'} variant={selectedMods.includes(item.name) ? 'outline' : 'secondary'} size="sm" disabled={inProgress || !item.version} onclick={() => toggleSelected(item.name, turnId)}>{#if selectedMods.includes(item.name)}<CheckIcon />Selected{:else}<PlusIcon />Select{/if}</TooltipButton>{/if}
    </div>
   </section>
  {/each}
 </div>{/if}
{/snippet}
<Sheet.Root bind:open>
 <Sheet.Trigger class={buttonVariants({ variant: 'secondary', size: 'sm' })}><MessageSquareIcon class="size-4" />Assistant</Sheet.Trigger>
 <Sheet.Content class="!w-full !max-w-2xl !gap-0 overflow-hidden flex flex-col">
  <Sheet.Header class="shrink-0 !px-5 !py-4">
   <div class="flex items-center gap-3 pr-6">
    <Sheet.Title class="flex shrink-0 items-center gap-2"><MessageSquareIcon class="size-5" />Assistant</Sheet.Title>
    <select aria-label="Chat history" class="ml-auto min-w-0 flex-1 truncate border px-2 py-1.5 text-sm" value={chat} disabled={inProgress || loading} onchange={(event) => selectChat(event.currentTarget.value)}>
     {#each chats as conversation (conversation.id)}<option value={conversation.id}>{conversation.title}</option>{/each}
    </select>
    <TooltipButton tooltip={inProgress ? 'Finish or stop the response first' : 'New chat'} variant="ghost" size="icon" disabled={inProgress || loading} onclick={createChat}><PlusIcon /></TooltipButton>
   </div>
   <Sheet.Description class="sr-only">{serverId ? 'Ask about this server and its factory.' : 'Ask about mods or review changes to this list.'}</Sheet.Description>
  </Sheet.Header>
  <div bind:this={feed} class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6" onscroll={() => { if (feed) followOutput = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80; }}>
   <div class="space-y-7">
    {#if hasMore}<Button variant="ghost" size="sm" disabled={olderLoading} onclick={loadOlder}>{olderLoading ? 'Loading…' : 'Earlier messages'}</Button>{/if}
    {#each turns.filter(turn => turn.state !== 'running') as turn (turn.id)}
     <section class="space-y-4" aria-label="Conversation turn">
      <div class="flex justify-end"><p class="max-w-[90%] whitespace-pre-wrap break-words border border-border bg-white/5 px-4 py-3 text-sm leading-relaxed">{turn.prompt}</p></div>
      {#if turn.state === 'error'}
       <div class="flex flex-wrap items-center gap-3"><p class="text-sm text-destructive">Could not finish this response.</p><Button variant="outline" size="sm" disabled={busy} onclick={() => { prompt = turn.prompt; void send(); }}><RefreshCwIcon class="size-4" />Retry</Button></div>
      {:else}<div class="pr-2"><AssistantMessage text={turn.answer} /></div>{/if}
      {@render modCards(turn.mods, turn.id)}
      {#if !serverId}
       {#each turn.plans ?? [] as plan (plan.id)}
        {#if plan.applied || !combineablePlanIds.includes(plan.id)}{@render planReceipt(plan)}{/if}
       {/each}
       {#if combineablePlanIds.length > 1 && turn.plans?.some(plan => plan.id === combineablePlanIds[0])}
        <section class="flex items-center gap-3 border border-border bg-white/5 px-4 py-3 text-sm">
         <span class="min-w-0 flex-1">{combineablePlanIds.length} separate mod reviews can be combined.</span>
         <TooltipButton tooltip={inProgress ? 'Response in progress' : 'Make one review of all these additions'} size="sm" disabled={inProgress} onclick={combineReviews}>Review together</TooltipButton>
        </section>
       {/if}
      {/if}
      {#each turn.results ?? [] as item}
       {@const failedSetup = setupId(item, 'failed')}
       <div class="space-y-2"><FactoryResultView {item} {serverId} />
        {#if failedSetup && !serverId}<div class="flex justify-end"><TooltipButton tooltip={inProgress ? 'Response in progress' : 'Retry setup on the same server'} disabled={inProgress} size="sm" onclick={() => retrySetup(failedSetup)}><RefreshCwIcon />Retry setup</TooltipButton></div>{/if}
        {#if item.tool === 'prepare_server_mod_list' && serverId}
         {@const plan = serverAssistantPlanSchema.safeParse(item.result)}
         {#if plan.success}
          <div class="flex justify-end">
           {#if plan.data.jobId}<span class="text-sm text-muted-foreground">Update started</span>
           {:else}<TooltipButton tooltip={busy ? 'Response in progress' : plan.data.problems.length ? 'Resolve the listed issues first' : !plan.data.changes.length ? 'Already applied' : 'Apply reviewed changes'} disabled={busy || !!plan.data.problems.length || !plan.data.changes.length} size="sm" onclick={() => applyServerPlan(turn.id, plan.data.hash)}><CheckIcon />Apply changes</TooltipButton>{/if}
          </div>
         {/if}
        {/if}
       </div>
      {/each}
     </section>
    {:else}
     {#if loading}<p role="status" class="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircleIcon class="size-4 animate-spin" />Loading conversation…</p>{:else if !activePrompt}
      <div class="grid gap-3 py-4">
       {#each (serverId ? ['How is the server doing?', 'What is limiting production?', 'What happened recently?'] : ['What overlaps in this list?', 'Which companion mods would add something useful?', 'Which mods do I use across my other lists?']) as suggestion}
        <Button variant="outline" class="!h-auto justify-start whitespace-normal px-4 py-3 text-left" disabled={busy} onclick={() => { prompt = suggestion; void send(); }}><MessageSquareIcon class="shrink-0" />{suggestion}</Button>
       {/each}
      </div>
     {/if}
    {/each}
    {#if activePrompt}
     <section class="space-y-4" aria-label="Current response">
      <div class="flex justify-end"><p class="max-w-[90%] whitespace-pre-wrap break-words border border-border bg-white/5 px-4 py-3 text-sm leading-relaxed">{activePrompt}</p></div>
      {#if text}<div class="pr-2"><AssistantMessage {text} /></div>{/if}
      {@render modCards(activeMods)}
      {#each activeResults as item}<FactoryResultView {item} {serverId} />{/each}
     </section>
    {/if}

   </div>
  </div>
  {#if !serverId && selectedMods.length}
   <div class="flex shrink-0 items-center gap-2 border-t border-border bg-background px-5 py-2 text-sm">
    <span class="min-w-0 flex-1 truncate">{selectedMods.length} {selectedMods.length === 1 ? 'mod' : 'mods'} selected</span>
    <TooltipButton tooltip="Clear selection" variant="ghost" size="icon" disabled={inProgress} onclick={() => selectedMods = []}><XIcon /></TooltipButton>
    <TooltipButton tooltip={inProgress ? 'Response in progress' : 'Review selected mods and their dependencies together'} size="sm" disabled={inProgress} onclick={reviewSelected}>Review selected</TooltipButton>
   </div>
  {/if}
  <div class="flex h-8 shrink-0 items-center gap-2 px-5 text-xs text-muted-foreground" role="status" aria-live="polite">
   {#if inProgress}<LoaderCircleIcon class="size-3.5 animate-spin motion-reduce:animate-none" /><span class="truncate">{progress || 'Thinking…'}</span>{:else if voiceState.error}<span class="truncate text-destructive" title={voiceState.error}>{voiceState.error}</span>{:else if voiceState.active || voiceState.connecting}<MicIcon class="size-3.5" /><span class="truncate">{voiceState.status}</span>{:else if compacted}<span>Earlier context summarized</span>{/if}
  </div>
  {#if voiceState.active || voiceState.connecting}
   <div class="grid h-24 shrink-0 grid-rows-2 gap-1 border-t border-border bg-white/5 px-5 py-2 text-sm" role="log" aria-live="off" aria-label="Voice captions">
    <p class="line-clamp-2 break-words" title={voiceState.userCaption}><span class="mr-2 text-xs text-muted-foreground">You</span>{voiceState.userCaption}</p>
    <p class="line-clamp-2 break-words" title={voiceState.assistantCaption}><span class="mr-2 text-xs text-muted-foreground">Assistant</span>{voiceState.assistantCaption}</p>
   </div>
  {/if}
  <form onsubmit={(event) => { event.preventDefault(); void send(); }} class="shrink-0 border-t border-border p-4 space-y-3">
   {#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
   {#if refreshError}<p role="status" class="text-sm text-muted-foreground">{refreshError} <button type="button" class="underline" onclick={() => void refresh()}>Retry</button></p>{/if}
   {#if modelError}<p role="status" class="text-sm text-muted-foreground">{modelError}</p>{/if}
   <Prompt bind:value={prompt} label="Message" placeholder={serverId ? "Ask about this server…" : "Ask about this list…"} maxLength={6000} busy={inProgress} {send} disabledReason={loading ? 'Loading conversation' : ''} stop={busy && controller ? stop : undefined}>
    {#snippet controls()}
     {#if voiceState.active || voiceState.connecting}
      <TooltipButton tooltip={voiceState.muted ? 'Unmute microphone' : 'Mute microphone'} variant="ghost" size="icon" disabled={voiceState.connecting} aria-pressed={voiceState.muted} onclick={() => voice.mute()}>{#if voiceState.muted}<MicOffIcon />{:else}<MicIcon />{/if}</TooltipButton>
      <TooltipButton tooltip="End voice" variant="ghost" size="icon" onclick={() => voice.stop()}><PhoneOffIcon /></TooltipButton>
     {:else}
      <TooltipButton tooltip={loading ? 'Loading conversation' : inProgress ? 'Wait for the current response' : 'Start voice'} disabled={loading || inProgress} variant="ghost" size="icon" onclick={() => voice.start({ chat, listId, serverId })}><MicIcon /></TooltipButton>
     {/if}
     <label class="flex min-w-0 items-center gap-2 text-xs"><span class="sr-only">Assistant model</span><select aria-label="Assistant model" class="min-w-0 max-w-56 border py-1.5 pl-2 pr-8 text-xs" bind:value={model} disabled={busy || !models.length}>{#each models as item}<option value={item.id}>{item.name}</option>{/each}</select></label>
     <label class="flex items-center gap-2 text-xs text-muted-foreground"><span>Effort</span><select aria-label="Thinking effort" class="border py-1.5 pl-2 pr-8 text-xs" bind:value={effort} disabled={busy || !effortChoices.length}>{#each effortChoices as level}<option value={level}>{({ minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' } as Record<string, string>)[level] ?? level}</option>{/each}</select></label>
    {/snippet}
   </Prompt>
  </form>
 </Sheet.Content>
</Sheet.Root>

<ModPreviewSheet bind:open={previewOpen} modName={previewName} />
