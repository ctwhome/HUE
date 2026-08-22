import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectTerminals } from './project-terminals';

const temporaryDirectories: string[] = [];
const managers: ProjectTerminals[] = [];

afterEach(() => {
	for (const manager of managers.splice(0)) manager.dispose();
	for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

async function outputUntil(
	manager: ProjectTerminals,
	projectId: string,
	terminalId: string,
	match: string
) {
	let cursor = 0;
	let output = '';
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const result = manager.read(projectId, terminalId, cursor);
		cursor = result.cursor;
		output += result.output;
		if (output.includes(match)) return output;
		await Bun.sleep(20);
	}
	throw new Error(`Terminal output did not contain ${match}: ${output}`);
}

test('runs an interactive shell in the project root', async () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-terminal-'));
	temporaryDirectories.push(projectRoot);
	const manager = new ProjectTerminals({ shell: '/bin/sh' });
	managers.push(manager);
	const terminal = manager.create('project-1', projectRoot, 80, 24);

	manager.write('project-1', terminal.terminalId, 1, 'pwd; printf "\\nHUE_TERMINAL_READY\\n"\r');
	const output = await outputUntil(manager, 'project-1', terminal.terminalId, 'HUE_TERMINAL_READY');

	expect(output).toContain(realpathSync(projectRoot));
});

test('deduplicates retried terminal input and rejects cross-project access', async () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-terminal-sequence-'));
	temporaryDirectories.push(projectRoot);
	const manager = new ProjectTerminals({ shell: '/bin/sh' });
	managers.push(manager);
	const terminal = manager.create('project-1', projectRoot, 80, 24);

	manager.write('project-1', terminal.terminalId, 1, 'printf "ONCE\\n"\r');
	manager.write('project-1', terminal.terminalId, 1, 'printf "TWICE\\n"\r');
	const output = await outputUntil(manager, 'project-1', terminal.terminalId, 'ONCE');

	expect(output).not.toContain('TWICE');
	expect(() => manager.read('project-2', terminal.terminalId, 0)).toThrow('Terminal not found');
	manager.close('project-1', terminal.terminalId);
	expect(() => manager.close('project-1', terminal.terminalId)).not.toThrow();
});

test('rejects terminal input sequence gaps', () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-terminal-gap-'));
	temporaryDirectories.push(projectRoot);
	const manager = new ProjectTerminals({ shell: '/bin/sh' });
	managers.push(manager);
	const terminal = manager.create('project-1', projectRoot, 80, 24);

	expect(() => manager.write('project-1', terminal.terminalId, 2, 'unsafe\r')).toThrow(
		'Unexpected input sequence'
	);
});
