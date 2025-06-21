<script lang="ts">
	import { MousePointer2 } from '@lucide/svelte';
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';

	interface CursorData {
		x: number;
		y: number;
		scroll: number;
		view: number;
		username: string;
		color: string;
		targetId?: string | null;
		rx?: number | null;
		ry?: number | null;
	}

	export let cursors: Record<string, CursorData> = {};

	let scrollY = 0;
	let docHeight = 1;

	function updateMetrics() {
		if (!browser) return;
		scrollY = window.scrollY;
		docHeight = document.documentElement.scrollHeight;
	}

	if (browser) {
		onMount(() => {
			updateMetrics();
			const onScroll = () => (scrollY = window.scrollY);
			const onResize = () => (docHeight = document.documentElement.scrollHeight);
			window.addEventListener('scroll', onScroll);
			window.addEventListener('resize', onResize);
			onDestroy(() => {
				window.removeEventListener('scroll', onScroll);
				window.removeEventListener('resize', onResize);
			});
		});
	}

	function computePosition(c: CursorData) {
		if (browser && c.targetId && typeof c.rx === 'number' && typeof c.ry === 'number') {
			const el = document.querySelector(`[data-mod-id="${c.targetId}"]`) as HTMLElement | null;
			if (el) {
				const rect = el.getBoundingClientRect();
				return {
					left: rect.left + c.rx * rect.width,
					top: rect.top + c.ry * rect.height
				};
			}
		}

		if (!browser) {
			return { left: 0, top: 0 };
		}

		// Fallback to original viewport-based positioning in browser
		const absoluteY = (c.scroll + c.y * c.view) * docHeight;
		return {
			left: c.x * window.innerWidth,
			top: absoluteY - scrollY
		};
	}
</script>

<!-- Remote cursor pointers -->
{#each Object.values(cursors) as c (c.username)}
	{@const pos = computePosition(c)}
	<div
		style="position: fixed; transform: translate(-50%, -50%); pointer-events: none; z-index: 50; transition: left 0.12s ease-out, top 0.12s ease-out;"
		style:left={pos.left + 'px'}
		style:top={pos.top + 'px'}
	>
		<MousePointer2 color={c.color} fill="#000000cc" class="absolute top-[2px] left-[2px]" />
		<div
			style="background: {c.color}; color: #ffffff; font-size: 10px; padding: 2px 4px; border-radius: 2px; white-space: nowrap; transform: translateY(16px) translateX(16px);"
		>
			{c.username}
		</div>
	</div>
{/each}

<!-- Minimap showing viewport of each collaborator -->
{#if Object.keys(cursors).length}
	<div
		class="fixed top-1/2 right-2 z-40 h-64 w-2 -translate-y-1/2 overflow-hidden rounded-sm bg-white/20"
	>
		{#each Object.values(cursors) as c (c.username + '-viewport')}
			<div
				class="absolute left-0 w-full opacity-80"
				style="background: {c.color};"
				style:top={c.scroll * 100 + '%'}
				style:height={Math.max(c.view * 100, 2) + '%'}
			></div>
		{/each}
	</div>
{/if}
