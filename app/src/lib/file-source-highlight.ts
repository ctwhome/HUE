import Prism from 'prismjs';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-makefile';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-yaml';
import { highlightMarkdown } from './markdown-highlight';

const languages: Record<string, string> = {
	bash: 'bash',
	css: 'css',
	go: 'go',
	html: 'markup',
	js: 'javascript',
	jsx: 'jsx',
	json: 'json',
	md: 'markdown',
	mdx: 'markdown',
	py: 'python',
	rs: 'rust',
	sh: 'bash',
	sql: 'sql',
	svelte: 'markup',
	toml: 'toml',
	ts: 'typescript',
	tsx: 'tsx',
	yaml: 'yaml',
	yml: 'yaml',
	zsh: 'bash'
};

const escapeHtml = (value: string) =>
	value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function fileSourceLanguage(path: string) {
	const name = path.split('/').at(-1)?.toLowerCase() ?? '';
	if (name === 'makefile' || name === 'gnumakefile') return 'makefile';
	if (name === 'dockerfile') return 'docker';
	if (name === '.env' || name.startsWith('.env.')) return 'bash';
	return languages[name.match(/\.([^.]+)$/)?.[1] ?? ''] ?? null;
}

export function highlightFileSource(value: string, path: string) {
	const language = fileSourceLanguage(path);
	if (language === 'markdown') return highlightMarkdown(value);
	const grammar = language ? Prism.languages[language] : undefined;
	return grammar ? Prism.highlight(value, grammar, language!) : escapeHtml(value);
}
