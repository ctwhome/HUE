export function automaticSessionIcon(title?: string | null): string {
	const value = title?.toLowerCase() ?? '';
	if (/greet|hello|welcome/.test(value)) return '👋';
	if (/bug|debug|error|fail|fix/.test(value)) return '🐛';
	if (/build|code|implement|refactor/.test(value)) return '🛠️';
	if (/plan|roadmap|design/.test(value)) return '🗺️';
	if (/research|analy[sz]e|review/.test(value)) return '🔎';
	if (/write|docs|content/.test(value)) return '✍️';
	if (/test|check|verify/.test(value)) return '🧪';
	return '💬';
}

export function validateIcon(input: unknown): string | null {
	if (input == null || input === '') return null;
	if (typeof input !== 'string') throw new Error('Icon must be an emoji or image');
	const icon = input.trim();
	if (!icon) return null;
	const image = icon.match(
		/^data:(image\/(?:png|jpeg|gif|webp|avif|x-icon|svg\+xml));base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/
	);
	if (image) {
		if (Math.ceil((image[2].length * 3) / 4) > 1024 * 1024) {
			throw new Error('Icon image must be 1 MB or smaller');
		}
		return icon;
	}
	if (icon.startsWith('data:') || Array.from(icon).length > 8) {
		throw new Error(
			'Project icon must be a short emoji or a PNG, JPEG, GIF, WebP, AVIF, SVG, or ICO image'
		);
	}
	return icon;
}
