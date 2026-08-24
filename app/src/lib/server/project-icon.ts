import { extname } from 'node:path';
import { ProjectFiles } from './project-files';

const mimeTypes: Record<string, string> = {
	'.avif': 'image/avif',
	'.gif': 'image/gif',
	'.ico': 'image/x-icon',
	'.jpeg': 'image/jpeg',
	'.jpg': 'image/jpeg',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.webp': 'image/webp'
};
const extensions = Object.keys(mimeTypes);

function dataUrl(files: ProjectFiles, path: string): string | null {
	try {
		const mime = mimeTypes[extname(path).toLowerCase()];
		return `data:${mime};base64,${files.readBytes(path, 1024 * 1024).toString('base64')}`;
	} catch {
		return null;
	}
}

export function findProjectFavicon(root: string): string | null {
	const files = new ProjectFiles(root);
	for (const directory of ['', 'public', 'static', 'app', 'src/app', 'src/routes']) {
		for (const extension of extensions) {
			const icon = dataUrl(files, `${directory ? `${directory}/` : ''}favicon${extension}`);
			if (icon) return icon;
		}
	}
	const favicon = files
		.tree()
		.entries.find(
			({ name, type, size }) =>
				type === 'file' &&
				size <= 1024 * 1024 &&
				/^favicon(?:-[^.]+)?\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/i.test(name)
		);
	if (!favicon) return null;
	return dataUrl(files, favicon.path);
}
