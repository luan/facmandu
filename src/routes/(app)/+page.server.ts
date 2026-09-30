import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { canManageServer } = await parent();
	redirect(307, canManageServer ? '/servers' : '/modlists');
};
