import { z } from 'zod';

export const formSchema = z.object({
	name: z.string().min(3).max(31),
	json: z.string()
});

export type FormSchema = typeof formSchema;
