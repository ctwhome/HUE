import { execFile, type ExecException } from 'node:child_process';

export function runCommand(
	command: string,
	args: string[],
	options: { cwd?: string; encoding?: BufferEncoding; timeout?: number; maxBuffer?: number } = {}
): Promise<{ status: number | null; stdout: Buffer; error?: ExecException }> {
	return new Promise((resolve) => {
		execFile(
			command,
			args,
			{
				...options,
				encoding: 'buffer',
				maxBuffer: options.maxBuffer ?? 1_048_576,
				killSignal: 'SIGKILL'
			},
			(error, stdout) => {
				resolve({
					status: error ? (typeof error.code === 'number' ? error.code : null) : 0,
					stdout,
					...(error ? { error } : {})
				});
			}
		);
	});
}
