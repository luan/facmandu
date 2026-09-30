<script lang="ts">
 import TooltipButton from '$lib/components/ui/button/tooltip-button.svelte';
	import { PlusIcon, CircleStopIcon, GitBranchIcon, LoaderCircleIcon, LockIcon } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { toast } from 'svelte-sonner';
	import Button from '$lib/components/ui/button/button.svelte';
	import ModPreviewSheet from './ModPreviewSheet.svelte';
	import { inspectDependencies } from '$lib/dependencies';
	import type { Mod } from '$lib/server/db/schema';
	import type { validateDependencies } from '$lib/server/services/dependencies';
	let { dependencyValidation, mods, factorioVersion, readOnly = false }: { dependencyValidation: ReturnType<typeof validateDependencies>; mods: Pick<Mod, 'id' | 'name' | 'title' | 'essential' | 'version' | 'enabled' | 'dependencies'>[]; factorioVersion: string; readOnly?: boolean } = $props();
	let pending = $state(false);
	let pendingModId = $state<string | null>(null);
	let previewOpen = $state(false);
	let previewName = $state<string | null>(null);
	const previewMod = $derived(mods.find((mod) => mod.name === previewName));
	const modMap = $derived(new Map(mods.map((mod) => [mod.name, mod])));
	const groups = $derived([
		[dependencyValidation.compatibilityIssues.length, dependencyValidation.compatibilityIssues.length === 1 ? 'incompatible mod' : 'incompatible mods'],
		[dependencyValidation.missingDependencies.length, 'missing dependencies'],
		[dependencyValidation.conflicts.length, 'conflicts'],
		[dependencyValidation.metadataErrors.length, 'metadata issues'],
		[dependencyValidation.versionIssues.length, 'version mismatches']
	] as const);
	const summary = $derived(groups.filter(([count]) => count).map(([count, label]) => `${count} ${label}`).join(' · '));
	const requiredBy = $derived.by(() => {
		const dependents = new Map<string, string[]>();
		for (const mod of mods.filter((item) => item.enabled)) {
			for (const dep of inspectDependencies(mod.dependencies).dependencies) {
				if (dep.type !== 'required' || dep.name === mod.name) continue;
				dependents.set(dep.name, [...(dependents.get(dep.name) ?? []), mod.title || mod.name]);
			}
		}
		return dependents;
	});
	const submit: SubmitFunction = ({ cancel, formData }) => {
		if (pending) { cancel(); return; }
		pending = true;
		pendingModId = formData.get('modid')?.toString() ?? null;
		return async ({ result, update }) => {
			try { await update({ invalidateAll: false }); if (result.type === 'success') await invalidate('app:modlist'); else toast.error(result.type === 'failure' ? String(result.data?.message || 'Could not change mod') : 'Could not change mod'); }
			finally { pending = false; pendingModId = null; }
		};
	};
</script>
{#if summary}
	<details class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
		<summary class="cursor-pointer text-sm font-medium">Needs review <span class="text-muted-foreground ml-2 font-normal">{summary}</span></summary>
		<div class="mt-4 max-h-80 space-y-4 overflow-auto text-sm">
			{#if dependencyValidation.compatibilityIssues.length}
				<section><h3 class="mb-2 font-medium">Incompatible with Factorio {factorioVersion}</h3>
					<ul class="divide-y divide-amber-500/15">
						{#each dependencyValidation.compatibilityIssues as issue (issue.mod)}
							{@const mod = modMap.get(issue.mod)}
							{@const dependents = requiredBy.get(issue.mod) ?? []}
							<li class="flex flex-wrap items-center justify-between gap-3 py-2">
								<div class="min-w-0"><p class="font-medium">{modMap.get(issue.mod)?.title || issue.mod}</p><p class="text-xs text-muted-foreground">Selected release: {modMap.get(issue.mod)?.version || 'unknown'} · Factorio {issue.actual}</p></div>
								<div class="flex flex-wrap items-center gap-2">
									<Button variant="outline" size="sm" onclick={() => { previewName = issue.mod; previewOpen = true; }}><GitBranchIcon class="size-4" />View releases</Button>
									{#if !readOnly && mod}
										<form method="POST" action="?/toggleStatus" use:enhance={submit}>
											<input type="hidden" name="modid" value={mod.id} />
											<TooltipButton tooltip={pending ? 'Updating mod' : mod.essential ? 'Locked' : dependents.length ? `Required by ${dependents.join(', ')}` : 'Disable'} type="submit" variant="outline" size="sm" disabled={pending || !!mod.essential || dependents.length > 0} aria-label={`Disable ${mod.title || mod.name}`} aria-busy={pendingModId === mod.id}>
												{#if pendingModId === mod.id}<LoaderCircleIcon class="size-4 animate-spin motion-reduce:animate-none" />{:else if mod.essential}<LockIcon class="size-4" />{:else}<CircleStopIcon class="size-4" />{/if}
												{mod.essential ? 'Locked' : 'Disable'}
											</TooltipButton>
										</form>
									{/if}
								</div>
								{#if dependents.length}<p class="basis-full text-xs text-muted-foreground">Required by {dependents.join(', ')}</p>{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/if}
			{#if dependencyValidation.missingDependencies.length}<section class="space-y-2"><h3 class="font-medium">Required dependencies</h3>
				{#each dependencyValidation.missingDependencies as name (name)}
					{@const mod = modMap.get(name)}
					<div class="flex items-center justify-between gap-3"><span>{name}</span>{#if !readOnly}<form method="POST" action={mod ? '?/toggleStatus' : '?/addMod'} use:enhance={submit}><input type="hidden" name={mod ? 'modid' : 'modName'} value={mod ? mod.id : name} /><Button type="submit" variant="outline" size="sm" disabled={pending}><PlusIcon class="size-4" />{mod ? 'Enable' : 'Add'}</Button></form>{/if}</div>
				{/each}
			</section>{/if}
			{#if dependencyValidation.conflicts.length}<section class="space-y-2"><h3 class="font-medium">Conflicting choices</h3><p class="text-muted-foreground text-xs">Choose which mod to keep. Required and locked mods cannot be disabled here.</p>
				{#each dependencyValidation.conflicts as conflict (`${conflict.mod}:${conflict.conflictsWith}`)}
					<div class="flex flex-wrap items-center gap-2">{#each [conflict.mod, conflict.conflictsWith] as name, index}{@const mod = modMap.get(name)}{#if index}<span class="text-muted-foreground">conflicts with</span>{/if}<span class="font-medium">{mod?.title || name}</span>{#if !readOnly && mod && !mod.essential}<form method="POST" action="?/toggleStatus" use:enhance={submit}><input type="hidden" name="modid" value={mod.id} /><Button type="submit" variant="outline" size="sm" disabled={pending} aria-label={`Disable ${name}`}><CircleStopIcon class="size-4" />Disable</Button></form>{/if}{/each}</div>
				{/each}
			</section>{/if}
			{#if dependencyValidation.versionIssues.length}<section class="space-y-2"><h3 class="font-medium">Version requirements</h3>{#each dependencyValidation.versionIssues as issue}<p>{issue.mod} requires {issue.dependency} {issue.requirement}; selected {issue.actual ?? 'unknown version'}.</p>{/each}</section>{/if}
			{#if dependencyValidation.metadataErrors.length}<section class="space-y-2"><h3 class="font-medium">Metadata</h3>{#each dependencyValidation.metadataErrors as issue}<p>{issue.mod}: {issue.message}</p>{/each}</section>{/if}
		</div>
	</details>
{/if}

<ModPreviewSheet bind:open={previewOpen} modName={previewName} modId={previewMod?.id} selectedVersion={previewMod?.version} {factorioVersion} {readOnly} />
