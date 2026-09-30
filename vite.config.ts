import { posix } from 'node:path';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

const devHost = process.env.FACMANDU_DEV_HOST;
const root = process.cwd();

function privateSource(url: string, root: string): boolean {
	let pathname: string;
	let rawPathname = url.split('?', 1)[0] ?? '';
	try {
		pathname = new URL(url, 'http://localhost').pathname;
		// Keep the decode cap bounded; deeper encodings are rejected below.
		for (let i = 0; i < 8 && pathname.includes('%'); i++) pathname = decodeURIComponent(pathname);
		for (let i = 0; i < 8 && rawPathname.includes('%'); i++)
			rawPathname = decodeURIComponent(rawPathname);
	} catch {
		return true;
	}
	if (/%[0-9a-f]{2}/i.test(pathname) || /%[0-9a-f]{2}/i.test(rawPathname)) return true;
	const path = posix.normalize(pathname.replaceAll('\\', '/'));
	if (rawPathname.replaceAll('\\', '/').startsWith('/@fs/') && !path.startsWith('/@fs/'))
		return true;
	if (/^\/(?:__open-in-editor|__inspect|__debug|__vite_inspect)(?:\/|$)/.test(path)) return true;
	if (/^\/@id\/.*\/(?:private|server)(?:\/|$)/.test(path)) return true;
	const fromFs = path.startsWith('/@fs/');
	const file = fromFs ? posix.normalize(path.slice(4)) : path;
	if (fromFs && file !== root && !file.startsWith(`${root}/`)) return true;
	const relative = file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file.slice(1);
	const segments = relative.split('/');
	const name = segments.at(-1) ?? '';
	return (
		segments.some(
			(segment, index) =>
				segment.startsWith('.') &&
				segment !== '.svelte-kit' &&
				!(segment === '.vite' && index === 1 && segments[0] === 'node_modules')
		) ||
		relative.startsWith('src/lib/server/') ||
		relative.startsWith('.svelte-kit/output/') ||
		relative.startsWith('.svelte-kit/generated/server/') ||
		relative.startsWith('src/routes/api/') ||
		(relative.startsWith('src/routes/') && name.startsWith('+server.')) ||
		name.includes('.server.') ||
		['infra', 'tests', 'build'].includes(segments[0] ?? '') ||
		// Add new root-level public assets here when they are introduced.
		(segments.length === 1 &&
			name.includes('.') &&
			!['favicon.png', 'favicon.webp', '__data.json'].includes(name))
	);
}

function protectPrivateSource(root: string, devHost?: string): Plugin {
	return {
		name: 'protect-private-source',
		enforce: 'pre',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const host = req.headers.host?.toLowerCase().replace(/:\d+$/, '');
				if (devHost && ![devHost.toLowerCase(), 'localhost', '127.0.0.1'].includes(host ?? '')) {
					res.statusCode = 403;
					res.end();
					return;
				}
				if (!privateSource(req.url ?? '/', root)) return next();
				res.statusCode = 403;
				res.end();
			});
		}
	};
}

export default defineConfig({
	plugins: [protectPrivateSource(root, devHost), tailwindcss(), sveltekit()],
	envDir: process.env.FACMANDU_DEV_ENV_DIR,
	server: {
		// Rebundling can change imports inside dev modules without changing their URLs.
		headers: { 'Cache-Control': 'no-store' },
		host: '127.0.0.1',
		port: 5173,
		strictPort: true,
		watch: { ignored: ['**/.svelte-kit/.svelte-check/**'] },
		fs: {
			strict: true,
			allow: [root],
			deny: [
				'.env',
				'.env.*',
				'*.{crt,pem,key,p12,pfx,cer,der}',
				'.npmrc',
				'.yarnrc.yml',
				'**/.git/**',
				'**/.data/**',
				'**/.cache/**',
				'**/.svelte-kit/output/**',
				'**/.svelte-kit/generated/server/**',
				'**/build/**',
				'**/src/lib/server/**',
				'**/src/routes/api/**',
				'**/+server.*',
				'**/hooks.server.*',
				'**/*.server.*',
				'**/infra/**',
				'**/tests/**',
				'**/.github/**',
				'**/vite.config.*',
				'**/svelte.config.*',
				'**/drizzle.config.*',
				'**/package.json',
				'**/bun.lock',
				'**/README.md'
			]
		},
		...(devHost && {
			allowedHosts: [devHost],
			hmr: { protocol: 'wss', host: devHost, clientPort: 443 }
		})
	}
});
