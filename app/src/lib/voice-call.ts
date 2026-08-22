export function takeSpeakableText(
	fullText: string,
	offset: number,
	complete: boolean
): { text: string; offset: number } {
	const remaining = fullText.slice(offset);
	if (!remaining) return { text: '', offset };
	if (complete) return { text: remaining, offset: fullText.length };
	const matches = [...remaining.matchAll(/[.!?](?:\s+|$)/g)];
	const end = matches.at(-1)?.index;
	if (end === undefined) return { text: '', offset };
	const length = end + matches.at(-1)![0].length;
	return { text: remaining.slice(0, length), offset: offset + length };
}
