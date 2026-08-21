export type ImageAttachment = {
	name: string;
	mimeType: string;
	data: string;
};

const supportedImageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const maxImages = 4;
const maxImageBytes = 10 * 1024 * 1024;

export function validateImageAttachments(input: unknown): ImageAttachment[] {
	if (input == null) return [];
	if (!Array.isArray(input) || input.length > maxImages) {
		throw new Error(`Attach no more than ${maxImages} images`);
	}
	return input.map((candidate) => {
		if (!candidate || typeof candidate !== 'object') throw new Error('Invalid image attachment');
		const { name, mimeType, data } = candidate as Record<string, unknown>;
		if (typeof name !== 'string' || !name.trim() || name.length > 255) {
			throw new Error('Each image requires a valid file name');
		}
		if (typeof mimeType !== 'string' || !supportedImageTypes.has(mimeType)) {
			throw new Error('Only PNG, JPEG, GIF, and WebP images are supported');
		}
		if (
			typeof data !== 'string' ||
			!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)
		) {
			throw new Error('Image data must be valid base64');
		}
		if (Math.ceil((data.length * 3) / 4) > maxImageBytes) {
			throw new Error('Each image must be 10 MB or smaller');
		}
		return { name: name.trim(), mimeType, data };
	});
}
