import {
	validateAttachments,
	type ImageAttachment,
	type InputAttachment
} from '$lib/message-content';

const data = (file: File) =>
	new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result).split(',')[1]);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});

export const unavailableAttachmentMetadata = ({ name, mimeType, size }: InputAttachment) => ({
	name,
	mimeType,
	size,
	available: false,
	reattachRequired: true
});

export async function readAttachmentFiles(files: FileList | File[], available: number) {
	const images: ImageAttachment[] = [],
		attachments: InputAttachment[] = [],
		errors: string[] = [];
	for (const file of Array.from(files).slice(0, available))
		try {
			const [item] = validateAttachments([
				{ name: file.name, mimeType: file.type, size: file.size, data: await data(file) }
			]);
			item.mimeType.startsWith('image/')
				? images.push({ name: item.name, mimeType: item.mimeType, data: item.data! })
				: attachments.push(item);
		} catch (cause) {
			errors.push(cause instanceof Error ? cause.message : String(cause));
		}
	return { images, attachments, errors };
}
