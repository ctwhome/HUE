export type ArtifactKind = 'image' | 'pdf' | 'html' | 'csv' | 'audio' | 'video' | 'text' | 'file';

export function artifactKind(path: string): ArtifactKind {
	if (/\.(?:png|jpe?g|gif|webp|svg)$/i.test(path)) return 'image';
	if (/\.pdf$/i.test(path)) return 'pdf';
	if (/\.html?$/i.test(path)) return 'html';
	if (/\.csv$/i.test(path)) return 'csv';
	if (/\.(?:mp3|wav|ogg|oga|m4a)$/i.test(path)) return 'audio';
	if (/\.(?:mp4|m4v|webm|mov)$/i.test(path)) return 'video';
	if (/\.(?:txt|log|md|markdown|json|xml|css|ts|mts|cts|tsx|py|rs|go|java)$/i.test(path))
		return 'text';
	return 'file';
}

export const artifactName = (path: string) => path.split('/').at(-1) ?? path;
export const artifactUrl = (mediaPath: string, path: string) =>
	`${mediaPath}?path=${encodeURIComponent(path)}`;
export const nativeArtifactOpenAllowed = (path: string) => !/\.(?:html?|svg)$/i.test(path);
