import { describe, expect, test } from 'bun:test';
import { permissionDetails } from './permission-consequence';

describe('permission details', () => {
	test('shows the ACP action and exact command context', () => {
		expect(
			permissionDetails({
				name: 'terminal',
				title: 'Run checks',
				kind: 'execute',
				args: { command: 'bun test --watch=false', cwd: '/Users/ctw/Sites/HUE/app' }
			})
		).toEqual({
			action: 'terminal',
			title: 'Run checks',
			consequence: 'Allowing this lets Hermes run a command.',
			preview: [
				{ label: 'Working directory', value: '/Users/ctw/Sites/HUE/app', code: true },
				{ label: 'Command', value: 'bun test --watch=false', code: true }
			]
		});
	});

	test('derives an edit target and preview without dumping unrelated arguments', () => {
		expect(
			permissionDetails({
				name: 'edit_file',
				title: 'Update settings',
				kind: 'edit',
				args: { path: 'src/settings.ts', diff: '-old\n+new', token: 'not-for-display' }
			})
		).toMatchObject({
			consequence: 'Allowing this lets Hermes change files.',
			preview: [
				{ label: 'Target', value: 'src/settings.ts', code: true },
				{ label: 'Edit preview', value: '-old\n+new', code: true }
			]
		});
	});

	test('describes known file operations without claiming project containment', () => {
		expect([
			permissionDetails({ kind: 'edit' }).consequence,
			permissionDetails({ name: 'delete_file' }).consequence,
			permissionDetails({ name: 'move_file' }).consequence
		]).toEqual([
			'Allowing this lets Hermes change files.',
			'Allowing this lets Hermes change files.',
			'Allowing this lets Hermes change files.'
		]);
	});

	test('derives a network destination and hides unavailable details', () => {
		expect(
			permissionDetails({
				name: 'fetch',
				title: 'Fetch issue',
				kind: 'network',
				args: { url: 'https://example.com/issues/1' }
			})
		).toMatchObject({
			consequence: 'Allowing this lets Hermes contact a network destination.',
			preview: [{ label: 'Network destination', value: 'https://example.com/issues/1', code: true }]
		});
		expect(permissionDetails({ title: 'Use tool' }).preview).toEqual([]);
	});

	test('keeps unknown ACP tools neutral despite suggestive argument keys', () => {
		expect(
			permissionDetails({
				name: 'custom_tool',
				kind: 'other',
				args: {
					command: 'rm -rf important',
					path: 'important',
					content: 'replacement',
					url: 'https://example.com'
				}
			})
		).toMatchObject({
			consequence: 'Allowing this lets Hermes perform this tool action.'
		});
	});
});
