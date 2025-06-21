<script lang="ts">
	import { MousePointer2 } from '@lucide/svelte';

	interface CursorData {
		x: number;
		y: number;
		username: string;
		color: string;
	}

	export let cursors: Record<string, CursorData> = {};
</script>

{#each Object.values(cursors) as c (c.username)}
	<div
		style="position: fixed; transform: translate(-50%, -50%); pointer-events: none; z-index: 50; transition: left 0.12s ease-out, top 0.12s ease-out;"
		style:left={c.x * 100 + '%'}
		style:top={c.y * 100 + '%'}
	>
		<!-- <svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill={c.color}
			style="transform: rotate(45deg);"
		>
			<path d="M3 2 L21 12 L12 21 z" />
		</svg> -->
		<MousePointer2 color={c.color} fill="#000000cc" class="absolute top-[2px] left-[2px]" />
		<div
			style="background: {c.color}; color: #ffffff; font-size: 10px; padding: 2px 4px; border-radius: 2px; white-space: nowrap; transform: translateY(16px) translateX(16px);"
		>
			{c.username}
		</div>
	</div>
{/each}
