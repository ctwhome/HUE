import { registerPlugin } from '@capacitor/core';

export type ShortcutKind = 'project' | 'session';

export interface HueNativePlugin {
	upsertShortcut(options: { kind: ShortcutKind; id: string; projectId?: string }): Promise<void>;
	requestPinShortcut(options: {
		kind: ShortcutKind;
		id: string;
		projectId?: string;
	}): Promise<{ accepted: boolean }>;
	removeShortcut(options: { kind: ShortcutKind }): Promise<void>;
	removeStaleShortcuts(options: { projectId?: string; sessionId?: string }): Promise<void>;
	createNotificationChannels(): Promise<void>;
	postTestNotification(options: {
		channel: 'completion' | 'attention' | 'errors';
		projectId?: string;
		sessionId: string;
	}): Promise<{ id: number }>;
}

export const HueNative = registerPlugin<HueNativePlugin>('HueNative');
