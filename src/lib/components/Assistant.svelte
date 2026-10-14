<script lang="ts">
 import type { AssistantContextUsage } from '$lib/assistant-context';
 import TooltipButton from '$lib/components/ui/button/tooltip-button.svelte';
 import Prompt from '$lib/components/Prompt.svelte';
 import { AssistantVoice, idleVoice } from '$lib/assistant-voice';
 import { factoryViewSchema, factoryPreviewPendingSchema } from '$lib/factory-images';
 import { blueprintArtifactSchema } from '$lib/blueprints';
 import { assistantResultGroups } from '$lib/factory-results';
 import { assistantElapsed, assistantToolFeedback } from '$lib/assistant-events';
 import FactoryResultView from '$lib/components/FactoryResult.svelte';
 import LazyDetails from '$lib/components/LazyDetails.svelte';
 import BlueprintResult from '$lib/components/BlueprintResult.svelte';
 import { assistantMilestone, assistantTimeline, savedBlueprintDrafts, serverAssistantPlanSchema, factoryTaskSchema, type FactoryResult, type AssistantMod } from '$lib/assistant-results';
 import { modThumbnailUrl } from '$lib/utils';
 import ModPreviewSheet from '../../routes/(app)/modlists/[id]/ModPreviewSheet.svelte';
 import AssistantMessage from '$lib/components/AssistantMessage.svelte';
 import { onDestroy, onMount, tick, untrack } from 'svelte';
 import { invalidate } from '$app/navigation';
 import { page } from '$app/state';
 import { RefreshCwIcon, MessageSquareIcon, CheckIcon, LoaderCircleIcon, PackageIcon, PlusIcon, XIcon, ChevronRightIcon, MicIcon, MicOffIcon, PhoneOffIcon, AlertTriangleIcon, SearchIcon, ArrowDownIcon } from '@lucide/svelte';
 import { Button, buttonVariants } from '$lib/components/ui/button';
 import * as Sheet from '$lib/components/ui/sheet';
 let { listId, serverId, contextLabel = '' }: { listId?: string; serverId?: string; contextLabel?: string } = $props();
 let activeResults = $state<FactoryResult[]>([]);
 let chat = $state('');
 let chats = $state<{ id: string; title: string; updatedAt: string; compactedAt: string | null; state?: 'running' | 'done' | 'error' | null; progress?: string; gameForce?: string | null }[]>([]);
 let chatSearch = $state('');
 const drafts = new Map<string, string>();
 function draftKey(id: string) { return `toby:draft:${page.data.user?.id ?? 'anonymous'}:${endpoint}:${id}`; }
 function readDraft(id: string) {
  if (drafts.has(id)) return drafts.get(id) ?? '';
  try { return sessionStorage.getItem(draftKey(id))?.slice(0, 6000) ?? ''; } catch { return ''; }
 }
 function saveDraft(id: string, value: string) {
  drafts.set(id, value);
  try { if (value) sessionStorage.setItem(draftKey(id), value); else sessionStorage.removeItem(draftKey(id)); } catch { /* Keep the in-memory draft when browser storage is unavailable. */ }
 }
 $effect(() => { if (chat) saveDraft(chat, prompt); });
 const visibleChats = $derived(chats.filter(item => item.title.toLowerCase().includes(chatSearch.trim().toLowerCase())));
 let hasMore = $state(false);
 let olderLoading = $state(false);
 let compacted = $state(false);
 let contextUsage = $state<AssistantContextUsage | null>(null);

 async function selectChat(id: string) {
  if (loading) return;
  if (chat) saveDraft(chat, prompt);
  voice.stop();
  // Detach the view without cancelling the persisted run in the previous chat.
  const running = runningViews.get(id);
  controller = running?.controller; busy = !!running; steeringBusy = false; feedback = running?.feedback ?? ''; progress = running?.progress ?? '';
  startedAt = running?.startedAt;
  chat = id; contextUsage = null; turns = []; plans = []; combineablePlanIds = []; selectedMods = []; selectedTurn = ''; prompt = readDraft(id); error = ''; refreshError = ''; text = ''; activePrompt = ''; activeMods = []; activeResults = []; loading = true;
  if (running) { activePrompt = running.prompt; text = running.text; activeResults = running.results; activeMods = running.mods; contextUsage = running.contextUsage; }
  await refresh(true, true);
 }
 async function createChat() {
  if (loading) return;
  loading = true;
  try {
   const response = await fetch(endpoint, { method: 'POST', body: new URLSearchParams({ operation: 'new-chat' }) });
   if (!response.ok) throw new Error('Could not create chat. Retry.');
   const created = await response.json(); const selected = { model, effort }; loading = false; await selectChat(created.id); model = selected.model; effort = selected.effort;
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
 let gamePlayer = $state<string | null>(null);
 let open = $state(false); let sidebar = $state<'history' | null>(null); let prompt = $state(''); let busy = $state(false); let progress = $state(''); let feedback = $state(''); let text = $state(''); let error = $state(''); let refreshError = $state('');
 let turns = $state<{ id: string; prompt: string; answer: string; state: string; createdAt?: string; model?: string | null; effort?: string | null; progress?: string; feedback?: string; mods: AssistantMod[]; results?: FactoryResult[]; plans?: ModlistPlan[] }[]>([]);
  const runningTurn = $derived(turns.findLast(turn => turn.state === 'running'));
  const inProgress = $derived(busy || !!runningTurn);
 let selectedDrafts = $state<Record<string, number>>({});
 let designPanel = $state(false);
 let selectedDesign = $state('');
 const designs = $derived.by(() => {
  const saved = new Map<string, { id: string; item: FactoryResult; label: string; entities: number }>();
  for (const item of [...turns.flatMap(turn => assistantResultGroups(turn.results ?? []).primary), ...assistantResultGroups(visibleResults).primary]) {
   const design = blueprintArtifactSchema.safeParse(item.result);
   if (!design.success) continue;
   const id = design.data.designId ?? design.data.blueprint;
   saved.set(id, { id, item, label: design.data.label, entities: design.data.entities.length });
  }
  return [...saved.values()];
 });
 const currentDesign = $derived(designs.find(design => design.id === selectedDesign) ?? designs.at(-1));
 function showDesign(item: FactoryResult) {
  const design = blueprintArtifactSchema.safeParse(item.result);
  if (design.success) { selectedDesign = design.data.designId ?? design.data.blueprint; designPanel = true; }
 }
 function layoutLabel(item: FactoryResult) {
  if (!item.display) return null;
  const design = blueprintArtifactSchema.safeParse(item.result);
  if (design.success) return design.data.label;
  const snapshot = factoryViewSchema.or(factoryPreviewPendingSchema).safeParse(item.result);
  return snapshot.success ? `Existing factory · ${snapshot.data.surface}` : null;
 }
 function toolOutcome(item: FactoryResult) {
  return assistantToolFeedback(item.tool ?? '', item);
 }
 function toolFailed(item: FactoryResult) {
  return !!item.result && typeof item.result === 'object' && 'error' in item.result;
 }
 function toolRunning(item: FactoryResult) { return item.tool === 'factory_task' && factoryTaskSchema.safeParse(item.result).data?.status === 'running'; }
 function jumpToLatest() { followOutput = true; if (feed) feed.scrollTop = feed.scrollHeight; }
 const latestLayoutTurn = $derived(activeResults.some(item => layoutLabel(item)) ? 'active' : turns.findLast(turn => turn.results?.some(item => layoutLabel(item)))?.id);
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
 const runningViews = new Map<string, { controller: AbortController; startedAt: number; prompt: string; text: string; progress: string; feedback: string; results: FactoryResult[]; mods: AssistantMod[]; contextUsage: AssistantContextUsage | null }>();
 let startedAt = $state<number>();
 let clock = $state(Date.now());
 let activePrompt = $state('');
 const responseStarted = $derived(activePrompt ? startedAt : runningTurn?.createdAt ? Date.parse(runningTurn.createdAt) : undefined);
 $effect(() => {
  if (!open || !inProgress) return;
  clock = Date.now();
  const timer = setInterval(() => clock = Date.now(), 1000);
  return () => clearInterval(timer);
 });
 let activeMods = $state<AssistantMod[]>([]);
  const visiblePrompt = $derived(activePrompt || runningTurn?.prompt || '');
  const visibleText = $derived(activePrompt ? text : runningTurn?.answer || '');
  const visibleResults = $derived(activePrompt ? activeResults : runningTurn?.results || []);
  const visibleMods = $derived(activePrompt ? activeMods : runningTurn?.mods || []);
 let previewName = $state<string | null>(null);
 let previewOpen = $state(false);
 let models = $state<{ id: string; name: string; efforts: string[]; defaultEffort: string; effortLabels?: Partial<Record<string, string>> }[]>([]);
 let model = $state('');
 const visibleContext = $derived(contextUsage?.model === model || gamePlayer ? contextUsage : null);
 const contextBudget = $derived(visibleContext ? Math.max(1, visibleContext.window) : 0);
 const contextPercent = $derived(visibleContext?.tokens !== null && visibleContext?.tokens !== undefined && visibleContext.window > 0 ? Math.round(visibleContext.tokens / contextBudget * 100) : null);
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
   if (!chat) prompt = readDraft(data.chat.id);
   chat = data.chat.id; gamePlayer = data.chat.gamePlayer ?? null; chats = data.chats; hasMore = data.hasMore; compacted = Boolean(data.chat.compactedAt); contextUsage = data.chat.contextUsage ?? null; turns = data.turns;
   if (!busy) { progress = runningTurn?.progress ?? ''; feedback = runningTurn?.feedback ?? ''; }
   plans = data.plans; combineablePlanIds = data.combineablePlanIds ?? [];
   if (data.models) { models = data.models; modelError = data.modelError; modelCatalogLoaded = true; }
   if (resetModel || !model || (data.models && !models.some(item => item.id === model))) model = models.some(item => item.id === data.model) ? data.model : models[0]?.id ?? '';
   if (resetModel || !effort) effort = data.effort;
   // Polls can learn an external run's model after its durable receipt arrives.
   if (!busy && runningTurn?.model && models.some(item => item.id === runningTurn.model)) {
    model = runningTurn.model;
    if (runningTurn.effort && models.find(item => item.id === model)?.efforts.includes(runningTurn.effort)) effort = runningTurn.effort;
   }
   if (turns.at(-1)?.answer === error || (activePrompt && turns.at(-1)?.prompt === activePrompt && turns.at(-1)?.state === 'done')) error = '';
   // After a detached stream, persisted activity owns both text and tool updates.
   if (!busy && activePrompt && turns.at(-1)?.prompt === activePrompt) { text = ''; activePrompt = ''; activeMods = []; activeResults = []; }
   refreshError = '';
   return true;
  } catch {
   if (selectedChat && chat !== selectedChat) return false;
   refreshError = 'Could not refresh conversation.';
   return false;
  } finally {
   if (!selectedChat || chat === selectedChat) {
   loading = false;
   clearTimeout(pollTimer);
   if (open && !busy && (serverId || gamePlayer || chats.some(conversation => conversation.state === 'running') || turns.some(turn => turn.state === 'running') || (activePrompt && refreshError))) pollTimer = setTimeout(() => void refresh(), !gamePlayer && !chats.some(conversation => conversation.state === 'running') ? 5000 : 1500);
   }
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
 let steeringBusy = $state(false);
 async function send() {
  if (loading || steeringBusy || !prompt.trim() || (inProgress && !serverId)) return;
  if (inProgress) {
   const message = prompt; const requestChat = chat; steeringBusy = true; error = '';
   try {
    const response = await fetch(endpoint, { method: 'POST', body: new URLSearchParams({ chat, operation: 'steer', prompt: message }) });
    if (!response.ok) { const data = await response.json(); throw new Error(data.message ?? 'Could not send steering'); }
    const view = runningViews.get(requestChat);
    if (view) view.prompt += `\n\nFollow-up: ${message}`;
    if (chat === requestChat) { if (prompt === message) prompt = ''; if (activePrompt) activePrompt += `\n\nFollow-up: ${message}`; await refresh(); }
   } catch (cause) { if (chat === requestChat) error = cause instanceof Error ? cause.message : 'Could not send steering'; }
   finally { if (chat === requestChat) steeringBusy = false; }
   return;
  }
  const message = prompt; const requestChat = chat; prompt = ''; saveDraft(chat, '');
  try { await ask(message); } catch { if (chat === requestChat && !prompt) prompt = message; }
 }
 async function ask(message: string): Promise<string> {
  if (inProgress || loading) throw new Error('The assistant is still working. Wait for its response, then ask again.');
  followOutput = true; busy = true; error = ''; text = ''; activeMods = []; activeResults = []; progress = 'Reading request…'; feedback = ''; controller = new AbortController();
  const previousPlanId = plans[0]?.id;
  activePrompt = message;
  startedAt = Date.now();
  const requestController = controller;
  const requestChat = chat;
  const view = { controller: requestController, startedAt, prompt: message, text: '', progress, feedback: '', results: activeResults, mods: activeMods, contextUsage };
  runningViews.set(requestChat, view);
  const ownsView = () => chat === requestChat && controller === requestController;
  let answer = '';
  let responseError = '';
  let accepted = false;
  try {
   const response = await fetch(endpoint, { method: 'POST', headers: { Accept: 'application/json' }, body: new URLSearchParams({ chat, prompt: message, model, effort }), signal: controller.signal });
   if (!response.ok) { const data = await response.json(); throw new Error(data.message ?? 'Could not send message'); }
   accepted = true;
   const reader = response.body?.getReader(); if (!reader) throw new Error('No response stream');

   const decoder = new TextDecoder(); let buffer = ''; let complete = false;
   for (;;) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) { const event = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); if (event.delta) answer += event.delta; if (typeof event.answer === 'string') answer = event.answer; if (event.error) responseError = event.error; chats = chats.map(item => item.id === requestChat ? { ...item, state: event.done ? 'done' : event.error ? 'error' : 'running', progress: event.feedback || event.progress || item.progress } : item); view.text = answer; if (event.results) view.results = event.results; if (event.mods) view.mods = event.mods; if (event.progress) view.progress = event.progress; if (typeof event.feedback === 'string') view.feedback = event.feedback; if (event.contextUsage) view.contextUsage = event.contextUsage; if (ownsView()) { if (event.compacted) compacted = true; if (event.contextUsage) contextUsage = event.contextUsage; if (event.results) activeResults = event.results; if (event.mods) activeMods = event.mods; text = answer; if (event.progress) progress = event.progress; if (typeof event.feedback === 'string') feedback = event.feedback; if (event.error) error = event.error; } if (event.done || event.error) complete = true; newline = buffer.indexOf('\n'); }
    if (complete) break;
   }
   if (responseError) throw new Error(responseError);
   return answer;
  } catch (cause) {
   // A lost browser stream does not cancel a persisted server turn. Refresh resumes its activity.
   if (serverId && accepted && !responseError && !requestController.signal.aborted) {
    if (ownsView()) { error = ''; progress = 'Reconnecting…'; }
    return answer;
   }
   const message = requestController.signal.aborted ? 'Stopped' : cause instanceof SyntaxError ? 'The response was interrupted. Retry.' : cause instanceof Error ? cause.message : 'Request failed'; if (ownsView()) error = message; throw new Error(message);
  }
  finally { runningViews.delete(requestChat); if (ownsView()) { busy = false; controller = undefined; progress = ''; feedback = ''; if (!accepted) { text = ''; activePrompt = ''; activeMods = []; activeResults = []; } await refresh(); if (!serverId && plans[0]?.applied && plans[0].id !== previousPlanId) await invalidate('app:modlist'); } }
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
 onDestroy(() => { voice.stop(); for (const view of runningViews.values()) view.controller.abort(); clearTimeout(pollTimer); });
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
        {:else if !serverId}<TooltipButton tooltip={inProgress ? 'Response in progress' : 'Apply all reviewed changes together'} size="sm" disabled={inProgress} onclick={() => apply(plan.id)}><CheckIcon />Apply changes</TooltipButton>{/if}
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
     {#if item.enabled}<span class="inline-flex items-center gap-1 text-xs text-muted-foreground"><CheckIcon class="size-3.5" />Enabled</span>{:else if !serverId}<TooltipButton tooltip={inProgress ? 'Response in progress' : !item.version ? `No release for Factorio ${item.factorioVersion}` : selectedMods.includes(item.name) ? 'Remove from review' : 'Select for one combined review'} variant={selectedMods.includes(item.name) ? 'outline' : 'secondary'} size="sm" disabled={inProgress || !item.version} onclick={() => toggleSelected(item.name, turnId)}>{#if selectedMods.includes(item.name)}<CheckIcon />Selected{:else}<PlusIcon />Select{/if}</TooltipButton>{/if}
    </div>
   </section>
  {/each}
 </div>{/if}
{/snippet}
{#snippet responseTimeline(items: FactoryResult[])}
 <section class="space-y-3 border-l border-border/70 pl-3" aria-label="Response activity">
  {#each assistantTimeline(items) as entry}
   {#if entry.kind === 'progress'}
    <div class="text-sm text-muted-foreground"><AssistantMessage text={entry.message} {serverId} /></div>
   {:else}
    {@const latest = entry.items.at(-1)}
    <LazyDetails class="text-sm text-muted-foreground" summaryClass="flex cursor-pointer list-none items-start gap-2 py-1 text-xs [&::-webkit-details-marker]:hidden">{#snippet summary()}<ChevronRightIcon class="mt-0.5 size-3 shrink-0" /><span class="min-w-0"><span class="block font-medium text-foreground/80">{latest?.title} <span class="font-normal text-muted-foreground">· {entry.items.length} {entry.items.length === 1 ? 'step' : 'steps'}</span></span>{#if latest && toolOutcome(latest)}<span class="mt-0.5 block leading-relaxed">{toolOutcome(latest)}</span>{/if}</span>{/snippet}
     <div class="mt-2 space-y-2 border-l border-border pl-3">
      {#each entry.items as item}<LazyDetails class="text-sm" summaryClass="flex cursor-pointer list-none items-start gap-2 py-1.5 [&::-webkit-details-marker]:hidden">{#snippet summary()}{#if toolRunning(item)}<LoaderCircleIcon class="mt-0.5 size-3.5 shrink-0 animate-spin motion-reduce:animate-none text-primary" />{:else if toolFailed(item)}<AlertTriangleIcon class="mt-0.5 size-3.5 shrink-0 text-destructive" />{:else}<CheckIcon class="mt-0.5 size-3.5 shrink-0 text-emerald-400/80" />{/if}<span class="min-w-0"><span class="block text-xs font-medium text-foreground/80">{item.title}</span>{#if toolOutcome(item)}<span class="mt-0.5 block text-xs leading-relaxed">{toolOutcome(item)}</span>{/if}</span><ChevronRightIcon class="ml-auto mt-0.5 size-3 shrink-0" />{/snippet}<FactoryResultView {item} {serverId} /></LazyDetails>{/each}
     </div>
    </LazyDetails>
   {/if}
  {/each}
 </section>
{/snippet}
<Sheet.Root bind:open>
 <Sheet.Trigger class={buttonVariants({ variant: 'secondary', size: 'sm' })}><MessageSquareIcon class="size-4" />Toby</Sheet.Trigger>
 <Sheet.Content class="!w-full !max-w-none !gap-0 overflow-clip flex flex-col">
  <Sheet.Header class="shrink-0 !px-5 !py-4">
   <div class="flex items-center gap-3 pr-6">
    <Sheet.Title class="flex shrink-0 items-center gap-2"><MessageSquareIcon class="size-5" />Toby</Sheet.Title>
    <div class="min-w-0 flex-1"><p class="truncate text-sm font-medium">{chats.find(item => item.id === chat)?.title || 'New conversation'}</p>{#if contextLabel}<p class="truncate text-xs text-muted-foreground">{contextLabel}</p>{/if}</div>
    {#if designs.length}<Button variant="ghost" size="sm" aria-expanded={designPanel} onclick={() => designPanel = !designPanel}>Designs <span class="text-xs text-muted-foreground">{designs.length}</span></Button>{/if}
    <Button variant="ghost" size="sm" class="lg:hidden" aria-expanded={sidebar === 'history'} onclick={() => sidebar = sidebar === 'history' ? null : 'history'}>Chats</Button>
    <TooltipButton tooltip="New chat" variant="ghost" size="icon" class="lg:hidden" disabled={loading} onclick={createChat}><PlusIcon /></TooltipButton>
   </div>
   <Sheet.Description class="sr-only">{serverId ? 'Ask about this server and its factory.' : 'Ask about mods or review changes to this list.'}</Sheet.Description>
  </Sheet.Header>
  <div class="harness-layout" class:design-panel={designPanel && designs.length > 0}>
   <aside class="harness-history border-r border-border bg-black/10" data-open={sidebar === 'history'} aria-label="Conversations">
    <div class="flex items-center justify-between px-3 py-3"><h2 class="text-xs font-semibold text-muted-foreground">Chats</h2><TooltipButton tooltip="New chat" variant="ghost" size="icon" disabled={loading} onclick={createChat}><PlusIcon class="size-4" /></TooltipButton></div>
    <label class="mx-3 mb-3 flex items-center gap-2 border border-border bg-background/50 px-2 py-1.5"><SearchIcon class="size-3.5 shrink-0 text-muted-foreground" /><input bind:value={chatSearch} aria-label="Find chats" placeholder="Find chats" class="min-w-0 w-full border-0 bg-transparent text-xs outline-none" data-1p-ignore /></label>
    <nav class="space-y-0.5 px-2 pb-4" aria-label="Chat history">
     {#each visibleChats as conversation (conversation.id)}<button type="button" class="flex min-h-10 w-full items-center gap-2 border border-transparent px-2.5 py-2 text-left text-xs hover:bg-white/5 disabled:opacity-50" class:active-chat={chat === conversation.id} aria-current={chat === conversation.id ? 'page' : undefined} title={[conversation.title, conversation.progress, new Date(conversation.updatedAt).toLocaleString()].filter(Boolean).join('\n')} disabled={loading} onclick={() => { sidebar = null; void selectChat(conversation.id); }}>{#if conversation.state === 'running'}<LoaderCircleIcon class="size-3.5 shrink-0 animate-spin text-primary" /><span class="sr-only">Running</span>{:else if conversation.state === 'error'}<AlertTriangleIcon class="size-3.5 shrink-0 text-amber-300" /><span class="sr-only">Needs attention</span>{:else}<MessageSquareIcon class="size-3.5 shrink-0 text-muted-foreground" />{/if}<span class="truncate">{conversation.title}</span></button>{:else}<p class="px-2.5 py-2 text-xs text-muted-foreground">No matching chats.</p>{/each}
    </nav>
   </aside>
   <main class="flex min-h-0 min-w-0 flex-col" aria-label="Assistant conversation">
  <div bind:this={feed} class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6" onscroll={() => { if (feed) followOutput = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80; }}>
   <div class="mx-auto w-full max-w-4xl space-y-7">
    {#if hasMore}<Button variant="ghost" size="sm" disabled={olderLoading} onclick={loadOlder}>{olderLoading ? 'Loading…' : 'Earlier messages'}</Button>{/if}
    {#each turns.filter(turn => turn.state !== 'running') as turn (turn.id)}
     {@const resultGroups = assistantResultGroups(turn.results ?? [])}
     <section class="space-y-4" aria-label="Conversation turn">
      <div class="flex justify-end"><p class="max-w-[90%] whitespace-pre-wrap break-words border border-border bg-white/5 px-4 py-3 text-sm leading-relaxed">{turn.prompt}</p></div>
      {#if resultGroups.details.length}
       {@const steps = resultGroups.details.filter(item => item.tool !== 'report_progress')}
       {@const failures = steps.filter(toolFailed).length}
       <LazyDetails class="text-sm text-muted-foreground" summaryClass="flex cursor-pointer list-none items-center gap-2 py-1 text-xs [&::-webkit-details-marker]:hidden">{#snippet summary()}<ChevronRightIcon class="size-3 shrink-0" /><span>Activity · {steps.length} {steps.length === 1 ? 'step' : 'steps'}{failures ? ` · ${failures} failed` : ''}</span>{/snippet}<div class="mt-2">{@render responseTimeline(resultGroups.details)}</div></LazyDetails>
      {/if}
      {#if turn.state === 'error'}
       {@const drafts = savedBlueprintDrafts(turn.results ?? [])}
       {@const saved = drafts[selectedDrafts[turn.id] ?? drafts.length - 1]}
       <div class="flex flex-wrap items-center gap-3"><p class="text-sm text-destructive">{turn.answer || 'Could not finish this response.'}</p>{#if !gamePlayer}<Button variant="outline" size="sm" disabled={busy} onclick={() => { prompt = `Continue my interrupted request: ${turn.prompt}\nVerify completed changes before repeating any writes, and finish what remains.`; void send(); }}><RefreshCwIcon class="size-4" />Retry</Button>{/if}</div>
      {#if saved}
       {#if drafts.length > 1}<label class="block text-sm text-muted-foreground">Saved drafts ({drafts.length})<select class="mt-2 w-full border border-border bg-background px-3 py-2 text-foreground" value={selectedDrafts[turn.id] ?? drafts.length - 1} onchange={(event) => { selectedDrafts[turn.id] = Number(event.currentTarget.value); }}>{#each drafts as draft, index}<option value={index}>{draft.label} · {draft.entities.length} entities</option>{/each}</select></label>{/if}
       <BlueprintResult blueprint={saved} {serverId} unfinished />
      {/if}
      {:else}<div class="pr-2"><AssistantMessage text={turn.answer} {serverId} /></div>{/if}
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
      {#each resultGroups.primary.filter(item => turn.state !== 'error' || !blueprintArtifactSchema.safeParse(item.result).success) as item}
       {@const failedSetup = setupId(item, 'failed')}
       {@const earlierLayout = layoutLabel(item)}
       <div class="space-y-2">
        {#if earlierLayout && turn.id !== latestLayoutTurn}
         <LazyDetails class="border border-border bg-white/[0.025] text-sm" summaryClass="cursor-pointer px-3 py-2 font-medium">{#snippet summary()}Earlier layout · {earlierLayout}{/snippet}<FactoryResultView {item} {serverId} /></LazyDetails>
        {:else if blueprintArtifactSchema.safeParse(item.result).success}{@render designCard(item)}{:else}<FactoryResultView {item} {serverId} />{/if}
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
     {#if loading}<p role="status" class="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircleIcon class="size-4 animate-spin" />Loading conversation…</p>{:else if !visiblePrompt}
      <div class="grid gap-3 py-4">
       {#each (serverId ? ['How is the server doing?', 'What is limiting production?', 'What happened recently?'] : ['What overlaps in this list?', 'Which companion mods would add something useful?', 'Which mods do I use across my other lists?']) as suggestion}
        <Button variant="outline" class="!h-auto justify-start whitespace-normal px-4 py-3 text-left" disabled={busy} onclick={() => { prompt = suggestion; void send(); }}><MessageSquareIcon class="shrink-0" />{suggestion}</Button>
       {/each}
      </div>
     {/if}
    {/each}
    {#if visiblePrompt}
     {@const resultGroups = assistantResultGroups(visibleResults)}
     <section class="space-y-4" aria-label="Current response">
      <div class="flex justify-end"><p class="max-w-[90%] whitespace-pre-wrap break-words border border-border bg-white/5 px-4 py-3 text-sm leading-relaxed">{visiblePrompt}</p></div>
      <div class="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircleIcon class="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" /><span>{responseStarted !== undefined && Number.isFinite(responseStarted) ? assistantElapsed('Working', responseStarted, clock) : 'Toby is working'}</span>{#if visibleResults.length}<span>· {visibleResults.filter(item => item.tool !== 'report_progress').length} steps</span>{/if}</div>
      {#each visibleResults.filter(toolRunning) as item}
       {@const task = factoryTaskSchema.parse(item.result)}
       <div role="status" class="flex items-start gap-2 border-l-2 border-primary/40 pl-3 text-xs text-muted-foreground"><LoaderCircleIcon class="mt-0.5 size-3.5 shrink-0 animate-spin motion-reduce:animate-none text-primary" /><span><span class="block font-medium text-foreground/80">Supply-chain survey</span>{task.label}</span></div>
      {/each}
      {@render responseTimeline(resultGroups.details)}
      {#if visibleText}<div class="pr-2"><AssistantMessage text={visibleText} {serverId} /></div>{/if}
      {@render modCards(visibleMods)}
      {#each resultGroups.primary as item}{#if blueprintArtifactSchema.safeParse(item.result).success}{@render designCard(item)}{:else}<FactoryResultView {item} {serverId} />{/if}{/each}
     </section>
    {/if}

   </div>
  </div>
  {#if !followOutput}<div class="flex justify-center py-1"><Button variant="secondary" size="sm" onclick={jumpToLatest}><ArrowDownIcon class="size-3.5" />Jump to latest</Button></div>{/if}
  {#if !serverId && selectedMods.length}
   <div class="flex shrink-0 items-center gap-2 border-t border-border bg-background px-5 py-2 text-sm">
    <span class="min-w-0 flex-1 truncate">{selectedMods.length} {selectedMods.length === 1 ? 'mod' : 'mods'} selected</span>
    <TooltipButton tooltip="Clear selection" variant="ghost" size="icon" disabled={inProgress} onclick={() => selectedMods = []}><XIcon /></TooltipButton>
    <TooltipButton tooltip={inProgress ? 'Response in progress' : 'Review selected mods and their dependencies together'} size="sm" disabled={inProgress} onclick={reviewSelected}>Review selected</TooltipButton>
   </div>
  {/if}
  {#if inProgress || voiceState.error || voiceState.active || voiceState.connecting}
  <div class="shrink-0 space-y-1 border-t border-border px-5 py-3 text-sm" role="status" aria-live="polite">
   {#if inProgress}{#if feedback && feedback !== assistantMilestone(visibleResults)}<p>{feedback}</p>{/if}<p class="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircleIcon class="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" /><span>{progress || 'Thinking…'}</span></p>{:else if voiceState.error}<span class="truncate text-destructive" title={voiceState.error}>{voiceState.error}</span>{:else if voiceState.active || voiceState.connecting}<MicIcon class="size-3.5" /><span class="truncate">{voiceState.status}</span>{/if}
  </div>
  {/if}
  {#if voiceState.active || voiceState.connecting}
   <div class="grid h-24 shrink-0 grid-rows-2 gap-1 border-t border-border bg-white/5 px-5 py-2 text-sm" role="log" aria-live="off" aria-label="Voice captions">
    <p class="line-clamp-2 break-words" title={voiceState.userCaption}><span class="mr-2 text-xs text-muted-foreground">You</span>{voiceState.userCaption}</p>
    <p class="line-clamp-2 break-words" title={voiceState.assistantCaption}><span class="mr-2 text-xs text-muted-foreground">Toby</span>{voiceState.assistantCaption}</p>
   </div>
  {/if}
  <section class="mx-auto flex w-full max-w-4xl shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs text-muted-foreground" aria-label="Context window">
   {#if visibleContext}
    <span title="Tokens in the latest model request and its response, including cached input. Not cumulative usage.">Context {visibleContext.tokens === null ? 'not measured yet' : visibleContext.tokens.toLocaleString()} / {visibleContext.window > 0 ? contextBudget.toLocaleString() : 'unknown'} tokens{contextPercent !== null ? ` · ${contextPercent}%` : ''}</span>
    {#if contextPercent !== null}<progress class="h-1.5 w-20 accent-primary" aria-label="Model context used" max="100" value={Math.min(100, contextPercent)}></progress>{/if}
    {#if visibleContext.compacting}<span>Compacting…</span>{:else if visibleContext.compactionFailed}<span class="text-destructive" role="status">Compaction failed; context retained</span>{:else}<span title={visibleContext.window > 0 ? `Automatic compaction above ${(visibleContext.window - visibleContext.reserve).toLocaleString()} tokens. Recent context stays verbatim; older context is summarized. Full chat history remains available.` : 'The provider has not supplied a context limit. Compaction can still recover a context overflow.'}>Auto compaction{compacted ? ' · Earlier context summarized' : ''}</span>{/if}
   {:else}<span>Context usage appears after a response.</span>{/if}
  </section>
  <form onsubmit={(event) => { event.preventDefault(); void send(); }} class="mx-auto w-full max-w-4xl shrink-0 border-t border-border p-4 space-y-3">
   {#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
   {#if refreshError}<p role="status" class="text-sm text-muted-foreground">{refreshError} <button type="button" class="underline" onclick={() => void refresh()}>Retry</button></p>{/if}
   {#if gamePlayer}<div class="flex items-center justify-between gap-3 text-sm text-muted-foreground"><span>{chats.find(item => item.id === chat)?.gameForce ? `Shared with force ${chats.find(item => item.id === chat)?.gameForce}` : `In-game conversation with ${gamePlayer}`}</span><Button variant="outline" size="sm" disabled={loading} onclick={createChat}>New web chat</Button></div>{/if}
   {#if !gamePlayer || inProgress}
   {#if modelError}<p role="status" class="text-sm text-muted-foreground">{modelError}</p>{/if}
   <Prompt bind:value={prompt} label="Message" placeholder={gamePlayer ? "Steer Toby’s current task…" : serverId ? "Ask about this server…" : "Ask about this list…"} maxLength={6000} busy={inProgress} allowSteering={!!serverId} {send} disabledReason={loading ? 'Loading conversation' : steeringBusy ? 'Sending steering' : ''} stop={inProgress ? stop : undefined}>
    {#snippet controls()}
     {#if !gamePlayer}
     {#if voiceState.active || voiceState.connecting}
      <TooltipButton tooltip={voiceState.muted ? 'Unmute microphone' : 'Mute microphone'} variant="ghost" size="icon" disabled={voiceState.connecting} aria-pressed={voiceState.muted} onclick={() => voice.mute()}>{#if voiceState.muted}<MicOffIcon />{:else}<MicIcon />{/if}</TooltipButton>
      <TooltipButton tooltip="End voice" variant="ghost" size="icon" onclick={() => voice.stop()}><PhoneOffIcon /></TooltipButton>
     {:else}
      <TooltipButton tooltip={loading ? 'Loading conversation' : inProgress ? 'Wait for the current response' : 'Start voice'} disabled={loading || inProgress} variant="ghost" size="icon" onclick={() => voice.start({ chat, listId, serverId })}><MicIcon /></TooltipButton>
     {/if}
     <label class="flex min-w-0 items-center gap-2 text-xs"><span class="sr-only">Assistant model</span><select aria-label="Assistant model" title={models.find(item => item.id === model)?.name} class="min-w-0 max-w-36 sm:max-w-56 border py-1.5 pl-2 pr-8 text-xs" bind:value={model} disabled={inProgress || !models.length}>{#each models as item}<option value={item.id}>{item.name}</option>{/each}</select></label>
     <label class="flex items-center gap-2 text-xs text-muted-foreground"><span>Effort</span><select aria-label="Thinking effort" class="border py-1.5 pl-2 pr-8 text-xs" bind:value={effort} disabled={inProgress || !effortChoices.length}>{#each effortChoices as level}<option value={level}>{models.find((item) => item.id === model)?.effortLabels?.[level] ?? ({ minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' } as Record<string, string>)[level] ?? level}</option>{/each}</select></label>
     {/if}
    {/snippet}
   </Prompt>
   {/if}
  </form>
   </main>
   {#if designPanel && currentDesign}
    <aside class="harness-designs min-h-0 overflow-y-auto border-l border-border bg-black/10" aria-label="Design workspace">
     <header class="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-4 py-3"><h2 class="text-sm font-semibold">Designs</h2><TooltipButton tooltip="Close designs" variant="ghost" size="icon" onclick={() => designPanel = false}><XIcon class="size-4" /></TooltipButton></header>
     <nav class="space-y-1 border-b border-border p-3" aria-label="Saved designs">{#each designs as design (design.id)}<button type="button" class="flex w-full items-center justify-between gap-3 border border-transparent px-2 py-2 text-left text-xs hover:bg-white/5" class:active-chat={design.id === currentDesign.id} aria-current={design.id === currentDesign.id ? 'true' : undefined} onclick={() => selectedDesign = design.id}><span class="truncate">{design.label}</span><span class="shrink-0 text-muted-foreground">{design.entities}</span></button>{/each}</nav>
     <div class="p-3"><FactoryResultView item={currentDesign.item} {serverId} /></div>
    </aside>
   {/if}

  </div>
 </Sheet.Content>
</Sheet.Root>

<ModPreviewSheet bind:open={previewOpen} modName={previewName} />

{#snippet designCard(item: FactoryResult)}
 {@const blueprint = blueprintArtifactSchema.safeParse(item.result)}
 {#if blueprint.success}<button type="button" class="flex w-full items-center gap-3 border border-border bg-white/[0.025] px-4 py-3 text-left hover:bg-white/5" onclick={() => showDesign(item)}><PackageIcon class="size-5 shrink-0 text-primary" /><span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold">{blueprint.data.label}</span><span class="mt-1 block text-xs text-muted-foreground">{blueprint.data.entities.length} entities · Native import validated</span></span><ChevronRightIcon class="size-4 shrink-0 text-muted-foreground" /></button>{/if}
{/snippet}

<style>
 .harness-layout { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto; flex: 1; min-height: 0; }
 .harness-history { display: none; min-height: 0; overflow-y: auto; }
 .harness-history[data-open="true"] { display: block; max-height: 16rem; }
 .harness-history { grid-row: 1; }
 .harness-layout > main { grid-row: 2; }
 .harness-designs { position: absolute; inset: 4.5rem 0 0; z-index: 20; background: var(--background); }
 .active-chat { border-color: var(--border); background: #ffffff08; color: var(--primary); }
 @media (min-width: 1024px) {
  .harness-layout { grid-template-columns: 14rem minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
  .harness-layout > main, .harness-history { grid-row: 1; }
  .harness-history { grid-column: 1; }
  .harness-layout > main { grid-column: 2; }
  .harness-layout.design-panel { grid-template-columns: 14rem minmax(0, 1fr) minmax(22rem, 35%); }
  .harness-designs { position: static; grid-row: 1; grid-column: 3; }
  .harness-history, .harness-history[data-open="true"] { display: block; max-height: none; }
 }
</style>
