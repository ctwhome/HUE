type CommandRunner = (command: string[]) => Promise<string>;

async function run(command: string[]): Promise<string> {
	const process = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited
	]);
	if (exitCode !== 0) {
		throw new Error(stderr.trim() || 'The system folder picker failed');
	}
	return stdout;
}

export async function pickSystemFolder(
	platform = process.platform,
	runner: CommandRunner = run
): Promise<string | null> {
	if (platform !== 'darwin') {
		throw new Error('System folder selection is only available on macOS');
	}
	let output: string;
	try {
		output = await runner([
			'osascript',
			'-e',
			'POSIX path of (choose folder with prompt "Choose a project folder")'
		]);
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		if (/User cancel(?:l)?ed|\(-128\)/i.test(message)) return null;
		throw cause;
	}
	const path = output.trim();
	return path || null;
}
