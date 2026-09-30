import { z } from 'zod';
export const registerSchema = z
	.object({
		invite: z.string().trim().min(1, 'An invitation is required').max(100),
		username: z
			.string()
			.min(3, 'Use at least 3 characters for your username')
			.max(31)
			.regex(/^[a-z0-9_-]+$/, 'Use lowercase letters, numbers, underscores or hyphens'),
		password: z.string().min(6, 'Use at least 6 characters for your password').max(1024),
		confirm: z.string().max(1024)
	})
	.refine((data) => data.password === data.confirm, {
		message: 'Passwords do not match',
		path: ['confirm']
	});
