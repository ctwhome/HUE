import { marked, Renderer } from 'marked';
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
import sanitizeHtml from 'sanitize-html';

const aliases: Record<string, string> = {
	js: 'javascript',
	ts: 'typescript',
	html: 'markup',
	py: 'python',
	rs: 'rust',
	shell: 'bash',
	sh: 'bash',
	yml: 'yaml',
	zsh: 'bash'
};
const escapeHtml = (value: string) =>
	value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function renderMessageMarkdown(text: string): string {
	const renderer = new Renderer();
	renderer.code = ({ text: code, lang }: { text: string; lang?: string }) => {
		const requested = String(lang ?? '')
			.trim()
			.split(/\s+/)[0]
			.toLowerCase();
		const language = aliases[requested] ?? requested;
		const grammar = Prism.languages[language];
		const highlighted = grammar ? Prism.highlight(code, grammar, language) : escapeHtml(code);
		const languageClass = language ? ` class="language-${language}"` : '';
		const label = language ? `<span class="code-language">${escapeHtml(language)}</span>` : '';
		return `<div class="code-block">${label}<div class="code-toolbar"></div><pre><code${languageClass}>${highlighted}</code></pre></div>`;
	};
	return sanitizeHtml(marked.parse(text, { async: false, renderer }), {
		parseStyleAttributes: false,
		allowedTags: sanitizeHtml.defaults.allowedTags,
		allowedAttributes: {
			'*': ['class'],
			a: ['href', 'name', 'target']
		}
	});
}
