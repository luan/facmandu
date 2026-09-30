<script lang="ts">
 import { toast } from 'svelte-sonner';
	import { PlusIcon } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import type { PageProps } from './$types';
	let { form }: PageProps = $props();
	let pending = $state(false);

	let imported = $state('');
</script>
<svelte:head><title>New mod list · Facmandu</title></svelte:head>
<div class="workbench !max-w-2xl flex flex-col gap-4">
	<header class="window-title"><a href="/modlists" class="text-sm text-muted-foreground hover:underline">Mod library</a><h1 class="mt-2 text-xl font-semibold">Create a mod list</h1></header>
	<form method="POST" class="factory-panel p-4" aria-busy={pending} use:enhance={() => {
		pending = true;
		return async ({ result, update }) => {
			try {
				if (result.type === 'error') toast.error(result.error.message ?? 'Could not create the list. Try again.');
				else await update({ reset: false });
			} finally { pending = false; }
		};
	}}>
		<fieldset disabled={pending} class="grid gap-4">
			<div class="grid gap-2"><label for="list-name" class="text-sm font-medium">Name</label><Input id="list-name" name="name" required maxlength={100} placeholder="My factory" value={form && 'name' in form ? form.name : ''} /></div>
			<div class="grid gap-2"><label for="factorio-version" class="text-sm font-medium">Factorio version</label><select id="factorio-version" name="factorioVersion" class="rounded-md border bg-background px-3 py-2" value={form && 'factorioVersion' in form ? form.factorioVersion : '2.1'}><option value="2.1">2.1</option><option value="2.0">2.0</option><option value="1.1">1.1</option><option value="1.0">1.0</option></select><p class="text-sm text-muted-foreground">Dependencies and mod versions will be resolved for this version.</p></div>
			<details class="rounded-md border p-4">
				<summary class="cursor-pointer text-sm font-medium">Import an existing mod-list.json (optional)</summary>
				<div class="mt-4 grid gap-3">
					<label for="import-file" class="text-sm">Choose a file</label>
					<input id="import-file" type="file" accept=".json,application/json" class="text-sm" onchange={async (event) => {
						const file = event.currentTarget.files?.[0];
						if (!file) return;
						if (file.size > 1_000_000) { toast.error('Import files must be smaller than 1 MB'); return; }
						try { imported = await file.text();  } catch { toast.error('Could not read the file'); }
					}} />
					<label for="import-json" class="text-sm">Or paste JSON</label>
					<Textarea id="import-json" name="json" bind:value={imported} class="min-h-48 font-mono text-sm" placeholder={'{"mods":[{"name":"example","enabled":true}]}'} maxlength={1000000} />
					<p class="text-sm text-muted-foreground">Versions from the file are preserved when compatible. Missing metadata and dependencies are filled in automatically.</p>
				</div>
			</details>
			<div class="flex items-center gap-4"><Button type="submit"><PlusIcon class="size-4" />{pending ? 'Creating…' : 'Create mod list'}</Button><a href="/modlists" class="text-sm hover:underline">Cancel</a></div>
		</fieldset>
	</form>
</div>
