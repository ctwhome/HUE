import type { ImageAttachment, InputAttachment } from '$lib/message-content';

export const QUICK_CAPTURE_KEY = 'hue:quick-capture:v1';
export type CaptureDraft = { text: string; projectId: string | null };
export type CaptureInput = {
	projectId: string | null;
	text: string;
	images: ImageAttachment[];
	attachments: InputAttachment[];
};

export function captureDraftStorage(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
	return {
		read(): CaptureDraft {
			try {
				const value = JSON.parse(storage.getItem(QUICK_CAPTURE_KEY) ?? 'null') as Record<
					string,
					unknown
				> | null;
				return {
					text: typeof value?.text === 'string' && value.text.length <= 16_000 ? value.text : '',
					projectId: typeof value?.projectId === 'string' ? value.projectId : null
				};
			} catch {
				return { text: '', projectId: null };
			}
		},
		write(value: CaptureDraft) {
			storage.setItem(QUICK_CAPTURE_KEY, JSON.stringify(value));
		},
		clear() {
			storage.removeItem(QUICK_CAPTURE_KEY);
		}
	};
}

export function splitCaptureAttachments(attachments: InputAttachment[]): {
	images: ImageAttachment[];
	attachments: InputAttachment[];
} {
	const images: ImageAttachment[] = [];
	const files: InputAttachment[] = [];
	for (const attachment of attachments) {
		if (attachment.mimeType.startsWith('image/') && attachment.data) {
			images.push({
				name: attachment.name,
				mimeType: attachment.mimeType,
				data: attachment.data
			});
		} else files.push(attachment);
	}
	return { images, attachments: files };
}
