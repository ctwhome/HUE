import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectBranch, sessionMatchesProjectRoot } from './services';

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

test('matches Hermes session cwd to Project root by canonical path', () => {
	const temporary = mkdtempSync(join(tmpdir(), 'hue-project-root-'));
	temporaryDirectories.push(temporary);
	const projectRoot = join(temporary, 'project');
	const projectAlias = join(temporary, 'project-alias');
	const otherRoot = join(temporary, 'other');
	mkdirSync(projectRoot);
	mkdirSync(otherRoot);
	symlinkSync(projectRoot, projectAlias);

	expect(sessionMatchesProjectRoot(projectRoot, projectAlias)).toBe(true);
	expect(sessionMatchesProjectRoot(projectRoot, otherRoot)).toBe(false);
	expect(sessionMatchesProjectRoot(projectRoot, join(temporary, 'missing'))).toBe(false);
});

test('reports the current Git branch for a Project root', () => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-branch-'));
	temporaryDirectories.push(projectRoot);
	Bun.spawnSync(['git', 'init', '-b', 'feature/context-bar'], { cwd: projectRoot });

	expect(projectBranch(projectRoot)).toBe('feature/context-bar');
});
