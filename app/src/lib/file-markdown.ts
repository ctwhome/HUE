import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

export const renderFileMarkdown = (value: string) =>
	sanitizeHtml(marked.parse(value, { async: false }), { parseStyleAttributes: false });
