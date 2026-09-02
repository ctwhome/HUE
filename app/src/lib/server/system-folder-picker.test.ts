import { expect, test } from 'bun:test';
import { pickSystemFolder } from './system-folder-picker';

test('opens the macOS folder chooser and returns its selected POSIX path', async () => {
	let command: string[] = [];
	const path = await pickSystemFolder('darwin', async (input) => {
		command = input;
		return '/Users/example/Projects/HUE\n';
	});

	expect(command).toEqual([
		'osascript',
		'-e',
		'POSIX path of (choose folder with prompt "Choose a project folder")'
	]);
	expect(path).toBe('/Users/example/Projects/HUE');
});

test('reports unsupported server platforms clearly', async () => {
	expect(pickSystemFolder('linux', async () => '')).rejects.toThrow(
		'System folder selection is only available on macOS'
	);
});

test('treats cancelling the macOS folder chooser as no selection', async () => {
	const selected = await pickSystemFolder('darwin', async () => {
		throw new Error('15:66: execution error: User cancelled. (-128)');
	});

	expect(selected).toBeNull();
});
