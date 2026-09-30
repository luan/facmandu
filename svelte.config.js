import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const devHost = process.env.FACMANDU_DEV_HOST;

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter(),
		env: { dir: process.env.FACMANDU_DEV_ENV_DIR ?? '.' },
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				// Transitions, virtual rows, and resizable panels use inline styles.
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:', 'blob:', 'https:'],
				'connect-src': [
					'self',
					...(process.env.NODE_ENV === 'development'
						? [
								'ws://localhost:5173',
								'ws://127.0.0.1:5173',
								...(devHost ? [`wss://${devHost}`] : [])
							]
						: [])
				],
				'object-src': ['none'],
				'base-uri': ['self'],
				'frame-ancestors': ['none'],
				'form-action': ['self']
			}
		}
	}
};

export default config;
