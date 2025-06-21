<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import {
		AlertTriangleIcon,
		XCircleIcon,
		ChevronDownIcon,
		PlusIcon,
		PowerIcon
	} from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { Mod } from '$lib/server/db/schema';

	interface Props {
		dependencyValidation: {
			missingDependencies: string[];
			conflicts: Array<{ mod: string; conflictsWith: string }>;
		};
		mods: Array<Omit<Mod, 'updatedBy'> & { updatedBy: { id: string; username: string } | null }>;
	}

	let { dependencyValidation, mods }: Props = $props();
	let showDetails = $state(false);
	let addingMods = $state<Set<string>>(new Set());

	const hasDependencyIssues = $derived(
		dependencyValidation.missingDependencies.length > 0 || dependencyValidation.conflicts.length > 0
	);

	const issueCount = $derived(
		dependencyValidation.missingDependencies.length + dependencyValidation.conflicts.length
	);

	// Create a map of mod names to mod objects for quick lookup
	const modMap = $derived(new Map(mods.map((mod) => [mod.name, mod])));

	// Separate missing dependencies into truly missing vs disabled
	const missingDepInfo = $derived(
		dependencyValidation.missingDependencies.map((depName) => {
			const existingMod = modMap.get(depName);
			return {
				name: depName,
				exists: !!existingMod,
				mod: existingMod,
				isDisabled: existingMod && !existingMod.enabled
			};
		})
	);

	function handleAddMod(modName: string) {
		addingMods.add(modName);
		addingMods = new Set(addingMods);
	}

	function handleAddComplete(modName: string) {
		addingMods.delete(modName);
		addingMods = new Set(addingMods);
	}

	async function refreshData() {
		await invalidateAll();
	}
</script>

{#if hasDependencyIssues}
	<div class="border-destructive/20 bg-destructive/10 rounded-lg border p-4">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				<AlertTriangleIcon class="text-destructive h-5 w-5" />
				<h3 class="text-destructive text-lg font-semibold">
					Dependency Issues ({issueCount})
				</h3>
			</div>
			<button
				type="button"
				onclick={() => (showDetails = !showDetails)}
				class="text-destructive hover:bg-destructive/10 hover:text-destructive flex items-center gap-1 rounded px-2 py-1 text-sm"
			>
				<ChevronDownIcon
					class="h-4 w-4 transition-transform duration-200 {showDetails ? 'rotate-180' : ''}"
				/>
				{showDetails ? 'Hide' : 'Show'} Details
			</button>
		</div>

		<p class="text-destructive mt-2 text-sm">
			{#if dependencyValidation.missingDependencies.length > 0 && dependencyValidation.conflicts.length > 0}
				{dependencyValidation.missingDependencies.length} missing dependencies and {dependencyValidation
					.conflicts.length} conflicts detected.
			{:else if dependencyValidation.missingDependencies.length > 0}
				{dependencyValidation.missingDependencies.length} missing dependencies detected.
			{:else}
				{dependencyValidation.conflicts.length} mod conflicts detected.
			{/if}
		</p>

		{#if showDetails}
			<div class="mt-4 space-y-4">
				{#if dependencyValidation.missingDependencies.length > 0}
					<div>
						<h4 class="text-destructive mb-2 flex items-center gap-2 font-medium">
							<XCircleIcon class="h-4 w-4" />
							Missing Required Dependencies ({dependencyValidation.missingDependencies.length})
						</h4>
						<div class="flex flex-wrap gap-2">
							{#each missingDepInfo as depInfo (depInfo.name)}
								<div class="flex items-center gap-1">
									<Badge variant="outline">
										{depInfo.name}
									</Badge>

									{#if depInfo.isDisabled}
										<!-- Enable button for disabled mods -->
										<form
											method="POST"
											action="?/toggleStatus"
											use:enhance={() => {
												handleAddMod(depInfo.name);
												return async ({ result }) => {
													handleAddComplete(depInfo.name);
													if (result.type === 'success' && result.data?.success) {
														await refreshData();
													}
												};
											}}
										>
											<input type="hidden" name="modid" value={depInfo.mod?.id} />
											<Button
												type="submit"
												size="icon-tight"
												variant="outline"
												disabled={addingMods.has(depInfo.name)}
												class="h-6 w-6 border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
												title="Enable {depInfo.name}"
											>
												{#if addingMods.has(depInfo.name)}
													<div
														class="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
													></div>
												{:else}
													<PowerIcon class="h-3 w-3" />
												{/if}
											</Button>
										</form>
									{:else}
										<!-- Add button for truly missing mods -->
										<form
											method="POST"
											action="?/addMod"
											use:enhance={() => {
												handleAddMod(depInfo.name);
												return async ({ result }) => {
													handleAddComplete(depInfo.name);
													// For added mods, we would need to refresh the parent data
													// since the mod gets added to the database with a new ID
													if (result.type === 'success' && result.data?.success) {
														// Could emit an event here for parent component to handle
														// For now, just let the optimistic update handle the UI
													}
												};
											}}
										>
											<input type="hidden" name="modName" value={depInfo.name} />
											<Button
												type="submit"
												size="icon-tight"
												variant="outline"
												disabled={addingMods.has(depInfo.name)}
												class="h-6 w-6"
												title="Add {depInfo.name}"
											>
												{#if addingMods.has(depInfo.name)}
													<div
														class="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
													></div>
												{:else}
													<PlusIcon class="h-3 w-3" />
												{/if}
											</Button>
										</form>
									{/if}
								</div>
							{/each}
						</div>
						<p class="text-destructive mt-2 text-sm">
							These mods are required by enabled mods but are not installed or enabled.
						</p>
					</div>
				{/if}

				{#if dependencyValidation.conflicts.length > 0}
					<div>
						<h4 class="text-destructive mb-2 flex items-center gap-2 font-medium">
							<AlertTriangleIcon class="h-4 w-4" />
							Mod Conflicts ({dependencyValidation.conflicts.length})
						</h4>
						<div class="space-y-2">
							{#each dependencyValidation.conflicts as conflict (`${conflict.mod}-${conflict.conflictsWith}`)}
								<div class="text-destructive flex items-center gap-2 text-sm">
									<div class="flex items-center gap-1">
										<Badge variant="destructive">
											{conflict.mod}
										</Badge>
										{#if modMap.get(conflict.mod)?.enabled}
											<form
												method="POST"
												action="?/toggleStatus"
												use:enhance={() => {
													handleAddMod(conflict.mod);
													return async ({ result }) => {
														handleAddComplete(conflict.mod);
														if (result.type === 'success' && result.data?.success) {
															await refreshData();
														}
													};
												}}
											>
												<input type="hidden" name="modid" value={modMap.get(conflict.mod)?.id} />
												<Button
													type="submit"
													size="icon-tight"
													variant="outline"
													disabled={addingMods.has(conflict.mod)}
													class="h-6 w-6 border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
													title="Disable {conflict.mod}"
												>
													{#if addingMods.has(conflict.mod)}
														<div
															class="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
														></div>
													{:else}
														<PowerIcon class="h-3 w-3" />
													{/if}
												</Button>
											</form>
										{/if}
									</div>
									<span>conflicts with</span>
									<div class="flex items-center gap-1">
										<Badge variant="destructive">
											{conflict.conflictsWith}
										</Badge>
										{#if modMap.get(conflict.conflictsWith)?.enabled}
											<form
												method="POST"
												action="?/toggleStatus"
												use:enhance={() => {
													handleAddMod(conflict.conflictsWith);
													return async ({ result }) => {
														handleAddComplete(conflict.conflictsWith);
														if (result.type === 'success' && result.data?.success) {
															await refreshData();
														}
													};
												}}
											>
												<input
													type="hidden"
													name="modid"
													value={modMap.get(conflict.conflictsWith)?.id}
												/>
												<Button
													type="submit"
													size="icon-tight"
													variant="outline"
													disabled={addingMods.has(conflict.conflictsWith)}
													class="h-6 w-6 border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
													title="Disable {conflict.conflictsWith}"
												>
													{#if addingMods.has(conflict.conflictsWith)}
														<div
															class="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
														></div>
													{:else}
														<PowerIcon class="h-3 w-3" />
													{/if}
												</Button>
											</form>
										{/if}
									</div>
								</div>
							{/each}
						</div>
						<p class="text-destructive mt-2 text-sm">
							These mods are incompatible and cannot be enabled together. Click the disable button
							to resolve conflicts.
						</p>
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}
