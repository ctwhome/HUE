import { expect, test } from 'bun:test';
import { renderMessageMarkdown } from './message-markdown';

test('highlights known code safely and adds keyboard-copy feedback control', () => {
	const html = renderMessageMarkdown(
		'```ts\nconst answer: number = 42;\n```\n\n<script>alert("unsafe")</script>'
	);

	expect(html).toContain('class="token keyword">const</span>');
	expect(html).toContain('aria-label="Copy code"');
	expect(html).not.toContain('<script>');
	expect(html).not.toContain('alert("unsafe")');
});

test('keeps Mermaid source inert when no direct safe renderer is installed', () => {
	const html = renderMessageMarkdown('```mermaid\ngraph TD\nA-->B\n```');

	expect(html).toContain('language-mermaid');
	expect(html).not.toContain('<svg');
	expect(html).not.toContain('<script');
});
