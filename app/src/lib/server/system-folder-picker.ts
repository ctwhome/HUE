type CommandRunner = (command: string[], signal?: AbortSignal) => Promise<string>;

async function run(command: string[], signal?: AbortSignal): Promise<string> {
	const child = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' });
	const abort = () => child.kill('SIGKILL');
	if (signal?.aborted) abort();
	else signal?.addEventListener('abort', abort, { once: true });
	try {
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited
		]);
		if (exitCode !== 0) {
			throw new Error(stderr.trim() || 'The system folder picker failed');
		}
		return stdout;
	} finally {
		signal?.removeEventListener('abort', abort);
	}
}

export async function pickSystemFolder(
	platform = process.platform,
	runner: CommandRunner = run,
	timeoutMs = 120_000
): Promise<string | null> {
	if (platform !== 'darwin') {
		throw new Error('System folder selection is only available on macOS');
	}
	let output: string;
	const controller = new AbortController();
	let timeout: ReturnType<typeof setTimeout>;
	try {
		output = await Promise.race([
			runner(
				[
					'osascript',
					'-e',
					'POSIX path of (choose folder with prompt "Choose a project folder")'
				],
				controller.signal
			),
			new Promise<never>((_, reject) => {
				timeout = setTimeout(() => {
					controller.abort();
					reject(new Error('The folder chooser did not respond. Try again.'));
				}, timeoutMs);
			})
		]);
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		if (/User cancel(?:l)?ed|\(-128\)/i.test(message)) return null;
		throw cause;
	} finally {
		clearTimeout(timeout!);
	}
	const path = output.trim();
	return path || null;
}
