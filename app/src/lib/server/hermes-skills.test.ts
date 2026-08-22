import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readHermesSkill, writeHermesSkill } from './hermes-skills';

function fixture() {
	const root = mkdtempSync(join(tmpdir(), 'hue-skills-'));
	const directory = join(root, 'community', 'browser-use');
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, 'SKILL.md'), '---\nname: browser-use\ndescription: Browse\n---\n\n# Browser Use\n');
	return { root, directory };
}

test('reads an installed skill by its declared name', () => {
	const { root } = fixture();
	expect(readHermesSkill('browser-use', root)).toEqual({
		name: 'browser-use',
		content: '---\nname: browser-use\ndescription: Browse\n---\n\n# Browser Use\n'
	});
});

test('atomically updates only the matching installed skill', () => {
	const { root, directory } = fixture();
	const content = '---\nname: browser-use\ndescription: Updated\n---\n\n# Browser Use\n';
	writeHermesSkill('browser-use', content, root);
	expect(readFileSync(join(directory, 'SKILL.md'), 'utf8')).toBe(content);
});

test('rejects traversal and renamed skill content', () => {
	const { root } = fixture();
	expect(() => readHermesSkill('../browser-use', root)).toThrow('Invalid skill name');
	expect(() =>
		writeHermesSkill('browser-use', '---\nname: another-skill\n---\n', root)
	).toThrow('Skill name must remain browser-use');
});
