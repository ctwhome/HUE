import { marked, Renderer } from 'marked';
import Prism from 'prismjs';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-typescript';
import sanitizeHtml from 'sanitize-html';

const aliases: Record<string, string> = {
	js: 'javascript',
	ts: 'typescript',
	html: 'markup',
	shell: 'bash',
	sh: 'bash'
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
		const languageClass = requested ? ` class="language-${requested}"` : '';
		return `<div class="code-block"><button type="button" data-copy-code aria-label="Copy code">Copy</button><pre><code${languageClass}>${highlighted}</code></pre></div>`;
	};
	return sanitizeHtml(marked.parse(text, { async: false, renderer }), {
		allowedTags: [...sanitizeHtml.defaults.allowedTags, 'button'],
		allowedAttributes: {
			'*': ['class'],
			a: ['href', 'name', 'target'],
			button: ['type', 'data-copy-code', 'aria-label']
		}
	});
}
