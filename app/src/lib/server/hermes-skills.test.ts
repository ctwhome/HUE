import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	deleteHermesSkill,
	hermesSkillAccessInventory,
	hermesSkillsRoot,
	readHermesSkill,
	writeHermesSkill
} from './hermes-skills';

function skill(root: string, directory: string, name: string) {
	const path = join(root, directory);
	mkdirSync(path, { recursive: true });
	writeFileSync(
		join(path, 'SKILL.md'),
		`---\nname: ${name}\ndescription: Test\n---\n\n# ${name}\n`
	);
	return path;
}

test('classifies custom, bundled, and hub skills from canonical profile-root metadata', () => {
	const root = mkdtempSync(join(tmpdir(), 'hue-skills-'));
	skill(root, 'custom', 'custom');
	skill(root, 'bundled', 'bundled');
	skill(root, 'community/hub', 'hub');
	writeFileSync(join(root, '.bundled_manifest'), 'bundled:hash\n');
	mkdirSync(join(root, '.hub'), { recursive: true });
	writeFileSync(
		join(root, '.hub', 'lock.json'),
		JSON.stringify({ installed: { hub: { install_path: 'community/hub' } } })
	);

	expect(readHermesSkill('custom', root)).toMatchObject({ provenance: 'custom', editable: true });
	expect(readHermesSkill('bundled', root)).toMatchObject({
		provenance: 'bundled',
		editable: false
	});
	expect(readHermesSkill('hub', root)).toMatchObject({ provenance: 'hub', editable: false });
	expect(Object.fromEntries(hermesSkillAccessInventory(root))).toEqual({
		bundled: { provenance: 'bundled', editable: false },
		custom: { provenance: 'custom', editable: true },
		hub: { provenance: 'hub', editable: false }
	});
});

test('reports hub provenance when hub ownership supersedes a bundled name', () => {
	const root = mkdtempSync(join(tmpdir(), 'hue-skills-'));
	skill(root, 'community/shared', 'shared');
	writeFileSync(join(root, '.bundled_manifest'), 'shared:old-hash\n');
	mkdirSync(join(root, '.hub'), { recursive: true });
	writeFileSync(
		join(root, '.hub', 'lock.json'),
		JSON.stringify({ installed: { shared: { install_path: 'community/shared' } } })
	);

	expect(readHermesSkill('shared', root)).toMatchObject({ provenance: 'hub', editable: false });
});

test('edits and deletes only custom skills while preserving declared name', () => {
	const root = mkdtempSync(join(tmpdir(), 'hue-skills-'));
	const custom = skill(root, 'custom', 'custom');
	skill(root, 'bundled', 'bundled');
	writeFileSync(join(root, '.bundled_manifest'), 'bundled:hash\n');
	const content = '---\nname: custom\ndescription: Updated\n---\n';

	writeHermesSkill('custom', content, root);
	expect(readFileSync(join(custom, 'SKILL.md'), 'utf8')).toBe(content);
	expect(() => writeHermesSkill('custom', '---\nname: renamed\n---\n', root)).toThrow(
		'Skill name must remain custom'
	);
	expect(() => writeHermesSkill('bundled', '---\nname: bundled\n---\n', root)).toThrow(
		'bundled skills are read-only'
	);
	expect(deleteHermesSkill('custom', root)).toEqual({ name: 'custom', deleted: true });
	expect(() => readHermesSkill('custom', root)).toThrow('not found');
});

test('never follows a skill symlink outside the active profile custom root', () => {
	const root = mkdtempSync(join(tmpdir(), 'hue-skills-'));
	const external = mkdtempSync(join(tmpdir(), 'hue-external-skill-'));
	skill(external, 'external', 'external');
	symlinkSync(join(external, 'external'), join(root, 'external'));

	expect(() => readHermesSkill('external', root)).toThrow('not found');
	expect(() => writeHermesSkill('external', '---\nname: external\n---\n', root)).toThrow(
		'not found'
	);
});

test('resolves the active profile under HERMES_HOME', () => {
	expect(hermesSkillsRoot('default', { HERMES_HOME: '/private/hermes' })).toBe(
		'/private/hermes/skills'
	);
	expect(hermesSkillsRoot('worker', { HERMES_HOME: '/private/hermes' })).toBe(
		'/private/hermes/profiles/worker/skills'
	);
});

test('fails closed when ownership metadata is malformed', () => {
	const root = mkdtempSync(join(tmpdir(), 'hue-skills-'));
	skill(root, 'custom', 'custom');
	mkdirSync(join(root, '.hub'), { recursive: true });
	writeFileSync(join(root, '.hub', 'lock.json'), '{not-json');

	expect(() => writeHermesSkill('custom', '---\nname: custom\n---\n', root)).toThrow(
		'ownership could not be verified'
	);
	expect(() => deleteHermesSkill('custom', root)).toThrow('ownership could not be verified');
	expect(() => hermesSkillAccessInventory(root)).toThrow('ownership could not be verified');
});

test('rejects oversized skill reads and UTF-8 writes by byte length', () => {
	const root = mkdtempSync(join(tmpdir(), 'hue-skills-'));
	const directory = skill(root, 'custom', 'custom');
	writeFileSync(join(directory, 'SKILL.md'), `---\nname: custom\n---\n${'a'.repeat(1_000_000)}`);
	expect(() => readHermesSkill('custom', root)).toThrow('Skill content exceeds 1 MB');

	writeFileSync(join(directory, 'SKILL.md'), '---\nname: custom\n---\n');
	expect(() =>
		writeHermesSkill('custom', `---\nname: custom\n---\n${'é'.repeat(500_000)}`, root)
	).toThrow('between 1 byte and 1 MB');
});
