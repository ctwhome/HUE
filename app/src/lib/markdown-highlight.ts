const escapeHtml = (value: string) =>
	value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function highlightInline(value: string): string {
	const syntax =
		/(`+[^`\n]*`+)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\[[^\]\n]+\]\([^)\n]+\))|(\*[^*\n]+\*|_[^_\n]+_)/g;
	let output = '';
	let cursor = 0;

	for (const match of value.matchAll(syntax)) {
		const index = match.index;
		output += escapeHtml(value.slice(cursor, index));
		const className = match[1]
			? 'syntax-code'
			: match[2]
				? 'syntax-strong'
				: match[3]
					? 'syntax-link'
					: 'syntax-emphasis';
		output += `<span class="${className}">${escapeHtml(match[0])}</span>`;
		cursor = index + match[0].length;
	}

	return output + escapeHtml(value.slice(cursor));
}

export function highlightMarkdown(markdown: string): string {
	let frontmatter = false;
	let fence = '';

	return markdown
		.split('\n')
		.map((line, index) => {
			const fenceMatch = line.match(/^(\s*)(```|~~~)(.*)$/);
			if (fenceMatch && (!fence || fence === fenceMatch[2])) {
				fence = fence ? '' : fenceMatch[2];
				return `${escapeHtml(fenceMatch[1])}<span class="syntax-fence">${escapeHtml(fenceMatch[2] + fenceMatch[3])}</span>`;
			}
			if (fence) return `<span class="syntax-code-block">${escapeHtml(line)}</span>`;

			if ((index === 0 || frontmatter) && line.trim() === '---') {
				frontmatter = !frontmatter;
				return `<span class="syntax-frontmatter-marker">${escapeHtml(line)}</span>`;
			}
			if (frontmatter) {
				const field = line.match(/^(\s*)([\w.-]+:)(.*)$/);
				if (field) {
					return `${escapeHtml(field[1])}<span class="syntax-frontmatter-key">${escapeHtml(field[2])}</span><span class="syntax-frontmatter-value">${escapeHtml(field[3])}</span>`;
				}
				return escapeHtml(line);
			}

			const heading = line.match(/^(\s*)(#{1,6})(\s+)(.*)$/);
			if (heading) {
				return `${escapeHtml(heading[1])}<span class="syntax-heading-marker">${heading[2]}</span>${heading[3]}<span class="syntax-heading">${highlightInline(heading[4])}</span>`;
			}

			const marker = line.match(/^(\s*)(>|[-+*]|\d+\.)(\s+)(.*)$/);
			if (marker) {
				return `${escapeHtml(marker[1])}<span class="syntax-list-marker">${escapeHtml(marker[2])}</span>${marker[3]}${highlightInline(marker[4])}`;
			}

			return highlightInline(line);
		})
		.join('\n');
}
