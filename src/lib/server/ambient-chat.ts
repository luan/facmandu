import { type AmbientChat, ambientRoute, ambientRouteRequest } from '$lib/ambient-chat';
import { accountProviderKey } from './assistant-providers';

export async function routeAmbientChat(ownerId: string, prompt: string, chats: AmbientChat[]) {
	const key = await accountProviderKey(ownerId, 'neuralwatt');
	const response = await fetch('https://api.neuralwatt.com/v1/systemone', {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(ambientRouteRequest(prompt, chats)),
		signal: AbortSignal.timeout(10_000)
	});
	if (!response.ok) throw new Error(`Clef chat routing unavailable (${response.status})`);
	return ambientRoute(await response.json(), chats);
}
