import type { ImageAttachment } from '$lib/message-content';
import type {
	WorkspaceActivity,
	WorkspacePlanEntry,
	WorkspaceSubagentTree,
	WorkspaceTimelineItem
} from '$lib';

export type Project = {
	id: string;
	name: string;
	rootPath: string;
	icon: string | null;
	createdAt: string;
	rootAvailable: boolean;
};

export type Session = {
	sessionId: string;
	cwd: string;
	title?: string | null;
	icon?: string | null;
	customIcon?: string | null;
	updatedAt?: string | null;
	busySince?: string | null;
	available?: boolean;
	recovery?: string | null;
	attention?: boolean;
	error?: boolean;
};

export type Workflow = { id: string; name: string; prompt: string; profile: string };
export type HermesCommand = { name: string; description: string; input?: { hint: string } | null };
export type HermesRuntime = {
	profile: string;
	clarify?: { status: 'unsupported' | 'available'; reason?: string };
	models?: {
		currentModelId: string;
		availableModels: Array<{ modelId: string; name: string; description?: string | null }>;
	} | null;
	modes?: {
		currentModeId: string;
		availableModes: Array<{ id: string; name: string; description?: string | null }>;
	} | null;
	usage?: { used: number; size: number };
};
export type TranscriptMessage = {
	role: 'user' | 'assistant';
	text: string;
	images?: ImageAttachment[];
	createdAt?: string;
};
export type SessionEvent = {
	sequence: number;
	type: string;
	payload: Record<string, unknown>;
	createdAt?: string;
};
export type PendingEnvelope = {
	id: string;
	projectId: string | null;
	sessionId: string;
	text: string;
	images: ImageAttachment[];
};
export type QueuedMessage = {
	id: string;
	text: string;
	images: ImageAttachment[];
	status: 'queued';
};
export type ActiveTurn = {
	messageId: string;
	status: 'queued' | 'running' | 'unknown';
	thought: string;
	output: string;
	images?: ImageAttachment[];
	error: string | null;
};
export type CachedSessionView = {
	timeline: WorkspaceTimelineItem[];
	transcript: TranscriptMessage[];
	subagents: WorkspaceSubagentTree[];
	activity: WorkspaceActivity[];
	plan: WorkspacePlanEntry[];
	commands: HermesCommand[];
	runtime: HermesRuntime;
	branch: string | null;
	queuedMessages: QueuedMessage[];
	eventCursor: number;
	activeMessageId: string;
	pendingAssistant: string;
	pendingImages: ImageAttachment[];
	pendingThought: string;
	delivery: string;
};
export type SessionLoad = {
	transcript: TranscriptMessage[];
	transcriptError?: string;
	cursor: number;
	activeTurn: ActiveTurn | null;
	events: SessionEvent[];
	messages: Array<{
		id: string;
		text: string;
		images: ImageAttachment[];
		status: string;
		createdAt?: string;
	}>;
	commands?: HermesCommand[];
	runtime?: HermesRuntime;
	branch?: string | null;
};
export type Directory = { name: string; path: string };
export type DirectoryListing = Directory & { parent: string | null; entries: Directory[] };
export type Api = <T>(url: string, options?: RequestInit) => Promise<T>;
