import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import Icons from 'unplugin-icons/vite';

const disableSanitizeHtmlPostcss = {
	name: 'sanitize-html-browser',
	resolveId(source: string, importer?: string) {
		if (source === 'postcss' && importer?.includes('/sanitize-html/')) return '\0disabled-postcss';
	},
	load(id: string) {
		if (id === '\0disabled-postcss')
			return 'export function parse() { throw new Error("HTML style parsing is disabled"); }';
	}
};

export default defineConfig({
	plugins: [
		Icons({ compiler: 'svelte' }),
		{
			name: 'docs-directory-index',
			configureServer(server) {
				server.middlewares.use((request, _response, next) => {
					if (request.url?.startsWith('/docs/')) {
						const [path, query] = request.url.split('?', 2);
						if (path.endsWith('/')) request.url = `${path}index.html${query ? `?${query}` : ''}`;
					}
					next();
				});
			}
		},
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			version: { pollInterval: 60_000 }
		})
	],
	server: {
		host: '127.0.0.1',
		port: 4010,
		strictPort: true,
		allowedHosts: ['m3-max.tail33436f.ts.net']
	},
	optimizeDeps: {
		rolldownOptions: { plugins: [disableSanitizeHtmlPostcss] }
	}
});
