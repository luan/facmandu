import { z } from 'zod';
export const loginSchema = z.object({
	username: z.string().min(2, 'Enter your username').max(50),
	password: z.string().min(1, 'Enter your password').max(1024)
});
