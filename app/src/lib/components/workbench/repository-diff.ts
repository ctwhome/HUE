export type DiffLine = {
	kind: 'addition' | 'deletion' | 'context' | 'meta';
	oldLine: number | null;
	newLine: number | null;
	text: string;
	raw: string;
};

export type DiffHunk = { header: string; lines: DiffLine[] };
export type DiffFile = { path: string; hunks: DiffHunk[] };

export type Repository = {
	isRepository: boolean;
	repositoryPath?: string;
	repositories?: Array<{ path: string; label?: string }>;
	branch: string | null;
	changes: Array<{
		path: string;
		index: string;
		worktree: string;
		fileUrl: string | null;
		diffUrl?: string;
	}>;
	worktrees: Array<{ path: string; branch: string | null; head: string }>;
	remotes: Array<{ name: string; webUrl: string | null }>;
};
export type GitHubItem = { number: number; title: string; url: string };
export type GitHubItems = {
	issueGroups: Array<{ milestone: string | null; issues: GitHubItem[] }>;
	pullRequests: GitHubItem[];
};
export type RepositoryDiffResponse = {
	scope: 'staged' | 'unstaged' | 'branch';
	base: string | null;
	diff: string;
	truncated: boolean;
	maxBytes: number;
	untrackedPaths: string[];
	untrackedPathsTruncated: boolean;
};
export type CommitModelsResponse = {
	options?: {
		providers?: Array<{
			slug: string;
			name: string;
			authenticated: boolean;
			models: string[];
		}>;
	};
};

export type FileDiffData = {
	oldFile: { fileName: string };
	newFile: { fileName: string };
	hunks: string[];
};

export function parseUnifiedDiff(diff: string): DiffFile[] {
	const files: DiffFile[] = [];
	let file: DiffFile | undefined;
	let hunk: DiffHunk | undefined;
	let oldLine = 0;
	let newLine = 0;
	for (const raw of diff.split('\n')) {
		if (raw.startsWith('diff --git ')) {
			const separator = raw.lastIndexOf(' b/');
			file = { path: separator === -1 ? raw.slice(11) : raw.slice(separator + 3), hunks: [] };
			files.push(file);
			hunk = undefined;
			continue;
		}
		if (file && raw.startsWith('+++ ') && raw !== '+++ /dev/null') {
			file.path = raw.slice(4).replace(/^b\//, '').split('\t')[0];
			continue;
		}
		if (file && raw.startsWith('@@')) {
			const match = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
			if (!match) continue;
			oldLine = Number(match[1]);
			newLine = Number(match[2]);
			hunk = { header: raw, lines: [] };
			file.hunks.push(hunk);
			continue;
		}
		if (!hunk) continue;
		if (raw.startsWith('+')) {
			hunk.lines.push({
				kind: 'addition',
				oldLine: null,
				newLine: newLine++,
				text: raw.slice(1),
				raw
			});
		} else if (raw.startsWith('-')) {
			hunk.lines.push({
				kind: 'deletion',
				oldLine: oldLine++,
				newLine: null,
				text: raw.slice(1),
				raw
			});
		} else if (raw.startsWith(' ')) {
			hunk.lines.push({
				kind: 'context',
				oldLine: oldLine++,
				newLine: newLine++,
				text: raw.slice(1),
				raw
			});
		} else if (raw) {
			hunk.lines.push({ kind: 'meta', oldLine: null, newLine: null, text: raw, raw });
		}
	}
	return files;
}

export function boundedDiffLineRange(lines: string[], start: number, end: number) {
	const first = Math.max(0, Math.min(start, end));
	const last = Math.min(lines.length - 1, Math.max(start, end));
	const clipped = last - first + 1 > 200;
	return { text: lines.slice(first, Math.min(last + 1, first + 200)).join('\n'), clipped };
}

export function fileDiffData(
	diff: string,
	path: string,
	currentContent: string,
	untracked: boolean
): FileDiffData {
	const files = parseUnifiedDiff(diff);
	const file =
		files.find((item) => item.path === path) ?? (files.length === 1 ? files[0] : undefined);
	const hunks =
		file?.hunks.map(({ header, lines }) =>
			[`--- a/${path}`, `+++ b/${path}`, header, ...lines.map(({ raw }) => raw)].join('\n')
		) ?? [];
	if (untracked && !hunks.length && currentContent) {
		const lines = currentContent.replace(/\r\n?/g, '\n').split('\n');
		if (lines.at(-1) === '') lines.pop();
		if (lines.length)
			hunks.push(
				`--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join('\n')}`
			);
	}
	return {
		oldFile: { fileName: path },
		newFile: { fileName: path },
		hunks
	};
}

export function repositoryDiffUrl(
	projectId: string,
	request: {
		scope: 'staged' | 'unstaged';
		repository: string;
		file: string;
		currentFile: boolean;
	}
) {
	const params = new URLSearchParams({
		view: 'diff',
		scope: request.scope,
		repository: request.repository,
		file: request.file
	});
	return `/api/projects/${encodeURIComponent(projectId)}/repository?${params}`;
}
