import { z } from 'zod';

export const schema = z.object({
	factorioUsername: z.string().min(1, 'Factorio username is required'),
	factorioPassword: z.string().min(1, 'Factorio password is required')
});

export type Schema = typeof schema;
