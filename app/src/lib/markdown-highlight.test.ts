import { expect, test } from 'bun:test';
import { highlightMarkdown } from './markdown-highlight';

test('highlights Markdown syntax without rendering embedded HTML', () => {
	const highlighted = highlightMarkdown(
		'---\nname: browser-use\n---\n\n# Browser **Use**\n\n`code` <script>alert(1)</script>\n'
	);

	expect(highlighted).toContain('<span class="syntax-frontmatter-key">name:</span>');
	expect(highlighted).toContain('<span class="syntax-heading-marker">#</span>');
	expect(highlighted).toContain('<span class="syntax-strong">**Use**</span>');
	expect(highlighted).toContain('<span class="syntax-code">`code`</span>');
	expect(highlighted).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
	expect(highlighted).not.toContain('<script>');
});
