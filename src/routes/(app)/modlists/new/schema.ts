import { z } from 'zod';
export const formSchema = z.object({
	name: z.string().trim().min(1, 'Give your mod list a name').max(100),
	factorioVersion: z.enum(['1.0', '1.1', '2.0', '2.1']),
	json: z.string().max(1_000_000).default('')
});
