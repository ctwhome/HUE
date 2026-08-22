export type FileEntry = {
	name: string;
	path: string;
	type: 'file' | 'directory';
	size: number;
	mtime: string;
};

export type FileVersion = { hash: string; mtimeNs: string; size: number };
export type DeleteImpact = {
	confirmation: string;
	files: number;
	directories: number;
	bytes: number;
	manifestHash: string;
};

export type FilePreview = FileEntry & {
	kind: 'text' | 'code' | 'markdown' | 'image' | 'audio' | 'video' | 'pdf' | 'binary';
	mime: string;
	content: string | null;
	version: FileVersion | null;
	concurrency: 'content-hash' | 'unavailable-file-exceeds-hash-limit';
};

export type Artifact = FileEntry & {
	classification: 'source' | 'generated' | 'diff' | 'screenshot' | 'recording' | 'verification';
	verified: false;
	provenance: string;
};

export function formatFileSize(size: number) {
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
	return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
