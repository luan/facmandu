import { z } from 'zod';

export const registerSchema = z
	.object({
		username: z
			.string()
			.min(3)
			.max(31)
			.regex(/^[a-z0-9_-]+$/),
		password: z.string().min(6),
		confirm: z.string().min(6)
	})
	.refine((data) => data.password === data.confirm, {
		message: 'Passwords do not match',
		path: ['confirm']
	});

export type RegisterSchema = typeof registerSchema;
