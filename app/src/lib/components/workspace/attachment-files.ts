import {
	validateAttachments,
	allowedAttachmentMimeTypes,
	attachmentLimits,
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

export type FingerprintedAttachment = InputAttachment & { fingerprint?: string };

export async function fingerprintAttachment(
	attachment: InputAttachment
): Promise<FingerprintedAttachment> {
	if (!attachment.data) return attachment;
	const digest = await crypto.subtle.digest(
		'SHA-256',
		Uint8Array.from(atob(attachment.data), (character) => character.charCodeAt(0))
	);
	return {
		...attachment,
		fingerprint: Array.from(new Uint8Array(digest), (byte) =>
			byte.toString(16).padStart(2, '0')
		).join('')
	};
}

export async function readAttachmentFiles(files: FileList | File[], stagedBytes = 0) {
	const images: ImageAttachment[] = [],
		attachments: InputAttachment[] = [],
		errors: string[] = [];
	for (const file of Array.from(files))
		try {
			if (!allowedAttachmentMimeTypes().includes(file.type))
				throw new Error('Attachment file type is not allowed');
			const maxBytes = file.type.startsWith('image/')
				? attachmentLimits.maxImageBytes
				: file.type.startsWith('video/')
					? attachmentLimits.maxVideoBytes
					: file.type.startsWith('text/') ||
						  ['application/json', 'application/xml'].includes(file.type)
						? attachmentLimits.maxTextBytes
						: attachmentLimits.maxDocumentBytes;
			if (file.size > maxBytes)
				throw new Error(`Attachment must be ${maxBytes / 1024 / 1024} MB or smaller`);
			if (stagedBytes + file.size > attachmentLimits.maxTotalBytes)
				throw new Error('Attachments must total 40 MB or smaller');
			const [item] = validateAttachments([
				{ name: file.name, mimeType: file.type, size: file.size, data: await data(file) }
			]);
			item.mimeType.startsWith('image/')
				? images.push({ name: item.name, mimeType: item.mimeType, data: item.data! })
				: attachments.push(await fingerprintAttachment(item));
			stagedBytes += file.size;
		} catch (cause) {
			errors.push(cause instanceof Error ? cause.message : String(cause));
		}
	return { images, attachments, errors };
}
