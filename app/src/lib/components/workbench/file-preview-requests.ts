import { api } from './api';
import type { FilePreview } from './file-types';

type PreviewRequest = {
	path: string;
	generation: number;
	controller: AbortController;
	result: Promise<FilePreview>;
};

export function createPreviewRequests() {
	let generation = 0;
	let controller: AbortController | null = null;
	return {
		begin(projectId: string, path: string): PreviewRequest {
			controller?.abort();
			controller = new AbortController();
			return {
				path,
				generation: ++generation,
				controller,
				result: api<FilePreview>(
					`/api/projects/${projectId}/files?mode=preview&path=${encodeURIComponent(path)}`,
					{ signal: controller.signal }
				)
			};
		},
		isCurrent(request: PreviewRequest, selectedPath: string) {
			return (
				request.generation === generation &&
				request.path === selectedPath &&
				!request.controller.signal.aborted
			);
		},
		cancel() {
			controller?.abort();
			controller = null;
			generation += 1;
		},
		isLatest(request: PreviewRequest) {
			return request.generation === generation;
		}
	};
}

export const sameFileVersion = (left: FilePreview['version'], right: FilePreview['version']) =>
	JSON.stringify(left) === JSON.stringify(right);

export function canSavePreview(
	preview: FilePreview | null,
	selectedPath: string,
	dirty: boolean,
	busy: boolean
): preview is FilePreview & { version: NonNullable<FilePreview['version']> } {
	return Boolean(
		preview?.version && preview.content !== null && selectedPath === preview.path && dirty && !busy
	);
}

export function isCurrentSave(
	saved: FilePreview,
	target: FilePreview & { version: NonNullable<FilePreview['version']> },
	selectedPath: string,
	preview: FilePreview | null
) {
	return (
		saved.path === target.path &&
		selectedPath === target.path &&
		preview?.path === target.path &&
		sameFileVersion(preview.version, target.version)
	);
}

export function previewContentUrl(projectId: string, path?: string) {
	return path
		? `/api/projects/${encodeURIComponent(projectId)}/files?mode=content&path=${encodeURIComponent(path)}`
		: '';
}

export function savePreview(projectId: string, preview: FilePreview, content: string) {
	return api<FilePreview>(`/api/projects/${projectId}/files`, {
		method: 'POST',
		body: JSON.stringify({ action: 'save', path: preview.path, content, expected: preview.version })
	});
}
