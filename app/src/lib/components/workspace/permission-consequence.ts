type ToolCall = { name?: string; title?: string; kind?: string; args?: unknown };
type PreviewRow = { label: string; value: string; code: true };

const consequenceByKind: Record<string, string> = {
	execute: 'Allowing this lets Hermes run a command.',
	edit: 'Allowing this lets Hermes change files.',
	delete: 'Allowing this lets Hermes change files.',
	move: 'Allowing this lets Hermes change files.',
	fetch: 'Allowing this lets Hermes contact a network destination.'
};

const consequenceByName: Record<string, string> = {
	terminal: consequenceByKind.execute,
	edit_file: consequenceByKind.edit,
	write_file: consequenceByKind.edit,
	delete_file: consequenceByKind.delete,
	move_file: consequenceByKind.move,
	fetch: consequenceByKind.fetch
};

const record = (value: unknown): Record<string, unknown> | null =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;

const text = (args: Record<string, unknown> | null, keys: string[]): string | null => {
	for (const key of keys) {
		const value = args?.[key];
		if (typeof value === 'string' && value) return value;
		if (Array.isArray(value) && value.every((part) => typeof part === 'string'))
			return JSON.stringify(value);
	}
	return null;
};

export function permissionDetails(toolCall: ToolCall) {
	const args = record(toolCall.args);
	const command = text(args, ['command', 'cmd']);
	const cwd = text(args, ['cwd', 'workingDirectory', 'working_directory', 'workdir']);
	const target = text(args, ['path', 'file', 'filePath', 'target']);
	const edit = text(args, ['diff', 'patch', 'content', 'newText', 'new_string']);
	const destination = text(args, ['url', 'uri', 'endpoint', 'host']);
	const preview: PreviewRow[] = [];
	if (cwd) preview.push({ label: 'Working directory', value: cwd, code: true });
	if (command) preview.push({ label: 'Command', value: command, code: true });
	if (target) preview.push({ label: 'Target', value: target, code: true });
	if (edit) preview.push({ label: 'Edit preview', value: edit, code: true });
	if (destination) preview.push({ label: 'Network destination', value: destination, code: true });

	const consequence =
		consequenceByKind[toolCall.kind?.toLowerCase() ?? ''] ??
		consequenceByName[toolCall.name?.toLowerCase() ?? ''] ??
		'Allowing this lets Hermes perform this tool action.';

	return {
		action: toolCall.name ?? toolCall.kind ?? 'Hermes tool',
		title: toolCall.title ?? 'Hermes requests permission.',
		consequence,
		preview
	};
}
