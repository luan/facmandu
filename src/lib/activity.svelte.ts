import { createContext } from 'svelte';
import type { Activity } from '$lib/server/activity';

// Per-layout state keeps users isolated during SSR and shares one progress stream in the browser.
export const [getActivityState, setActivityState] = createContext<{ items: Activity[] }>();
