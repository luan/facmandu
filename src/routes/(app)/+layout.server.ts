import { redirect } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => {
	const user = requireLogin();
	return { user };
};

function requireLogin() {
	const { locals, url } = getRequestEvent();

	if (!locals.user) {
		return redirect(303, `/login?redirectTo=${url.pathname}`);
	}

	return locals.user;
}
