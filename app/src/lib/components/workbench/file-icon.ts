export type FileIconKind =
	| 'archive'
	| 'audio'
	| 'code'
	| 'config'
	| 'database'
	| 'document'
	| 'file'
	| 'image'
	| 'lock'
	| 'markdown'
	| 'pdf'
	| 'presentation'
	| 'spreadsheet'
	| 'text'
	| 'video';

const extensions: Record<string, FileIconKind> = Object.fromEntries(
	Object.entries({
		archive: ['7z', 'bz2', 'gz', 'rar', 'tar', 'tgz', 'zip'],
		audio: ['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav'],
		code: [
			'c',
			'cpp',
			'cs',
			'css',
			'go',
			'html',
			'java',
			'js',
			'jsx',
			'php',
			'py',
			'rb',
			'rs',
			'sh',
			'sql',
			'svelte',
			'ts',
			'tsx',
			'vue',
			'zsh'
		],
		config: [
			'conf',
			'config',
			'env',
			'ini',
			'json',
			'jsonc',
			'properties',
			'toml',
			'xml',
			'yaml',
			'yml'
		],
		database: ['db', 'sqlite', 'sqlite3'],
		document: ['doc', 'docx', 'odt', 'pages', 'rtf'],
		image: ['avif', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'webp'],
		lock: ['lock', 'lockb'],
		markdown: ['md', 'mdx'],
		pdf: ['pdf'],
		presentation: ['key', 'odp', 'ppt', 'pptx'],
		spreadsheet: ['csv', 'ods', 'xls', 'xlsx'],
		text: ['cff', 'log', 'txt'],
		video: ['mkv', 'mov', 'mp4', 'webm']
	}).flatMap(([kind, values]) => values.map((extension) => [extension, kind as FileIconKind]))
);

export function fileIconKind(path: string): FileIconKind {
	const name = path.split('/').at(-1)?.toLowerCase() ?? '';
	if (name === 'makefile' || name === 'gnumakefile' || name === 'dockerfile') return 'config';
	if (name === '.env' || name.startsWith('.env.')) return 'config';
	if (name === '.gitignore' || name === '.prettierignore' || name === '.npmrc') return 'config';
	return extensions[name.match(/\.([^.]+)$/)?.[1] ?? ''] ?? 'file';
}
