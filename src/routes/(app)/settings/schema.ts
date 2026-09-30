import { z } from 'zod';
export const schema = z.object({
	factorioUsername: z.string().trim().min(1, 'Enter your Factorio username').max(100),
	factorioToken: z
		.string()
		.trim()
		.min(1, 'Enter your Factorio service token')
		.max(1024)
		.regex(/^[A-Za-z0-9_-]+$/, 'Enter a valid service token')
});
