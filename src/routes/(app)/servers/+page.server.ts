import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url }) => {
	const { canManageServer } = await parent();
	if (!canManageServer) error(403, 'Server management is restricted');
	return { reviewListId: url.searchParams.get('list') };
};
