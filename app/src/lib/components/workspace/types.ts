import type { ImageAttachment, InputAttachment, ReviewContext } from '$lib/message-content';
import type { WorkMode } from '$lib/work-mode';
import type {
	WorkspaceActivity,
	WorkspacePlanEntry,
	WorkspaceSubagentTree,
	WorkspaceTimelineItem
} from '$lib';

export type Project = {
	id: string;
	name: string;
	icon: string | null;
	color: string | null;
	group: string | null;
	primaryPath: string;
	folders: Array<{ path: string; label: string | null; isPrimary: boolean; available: boolean }>;
	rootAvailable: boolean;
	sessionCount: number;
	runningCount?: number;
	attentionCount?: number;
	unreadCount?: number;
};

export type WorkspaceProps = {
	projects: Project[];
	chatSessionCount?: number;
	cronSessionCount?: number;
	projectsCapability?: 'available' | 'unavailable' | 'outage';
	projectsError?: string;
	reconciliationIssues?: Array<{ legacyProjectId: string; kind: string; message: string }>;
};

export type SessionCollection = 'chats' | 'cron';

export type ExternalCronJob = {
	jobId: string;
	name: string;
	profile: string;
	profileName: string;
	schedule: string;
	scheduleKind: 'cron' | 'interval' | 'once' | 'unknown';
	enabled: boolean;
	state: 'scheduled' | 'paused' | 'completed' | 'error' | 'unknown';
	nextRunAt: string | null;
	lastRunAt: string | null;
	lastStatus: string | null;
	unreadCount?: number;
};

export type Session = {
	sessionId: string;
	cwd: string;
	pending?: boolean;
	title?: string | null;
	icon?: string | null;
	customIcon?: string | null;
	updatedAt?: string | null;
	busySince?: string | null;
	available?: boolean;
	recovery?: string | null;
	attention?: boolean;
	error?: boolean;
	status?:
		'running' | 'waiting-permission' | 'waiting-answer' | 'unknown' | 'failed' | 'cancelled' | null;
	unreadAttention?: boolean;
	pinned?: boolean;
	archived?: boolean;
	folder?: string | null;
	tags?: string[];
	workMode?: WorkMode;
};

export type SessionFinderResult = Omit<Session, 'status'> & {
	projectId: string | null;
	projectName: string | null;
	status: 'running' | 'waiting' | 'unknown' | 'failed' | 'archived' | null;
};

export type Workflow = {
	id: string;
	name: string;
	prompt: string;
	folder?: string | null;
	favorite?: boolean;
	profile: string;
	bundle: string;
	archived: boolean;
	createdAt?: string;
	updatedAt?: string;
};
export type HermesBundle = {
	name: string;
	slug: string;
	description: string;
	skills: string[];
	instruction: string;
};
export type HermesBundleSkill = {
	name: string;
	description?: string;
	category?: string;
	enabled: boolean;
	provenance: 'custom' | 'bundled' | 'hub';
	permissions: { read: boolean; write: boolean; delete: boolean };
};
export type HermesCommand = { name: string; description: string; input?: { hint: string } | null };
export type HermesRuntime = {
	profile: string;
	capabilities?: {
		loadSession: boolean;
		promptImage: boolean;
		sessionList: boolean;
		sessionFork: boolean;
		sessionResume: boolean;
		commands: string[];
	};
	clarify?: { status: 'unsupported' | 'available'; reason?: string };
	models?: {
		currentModelId: string;
		availableModels: Array<{ modelId: string; name: string; description?: string | null }>;
	} | null;
	modes?: {
		currentModeId: string;
		availableModes: Array<{ id: string; name: string; description?: string | null }>;
	} | null;
	configOptions?: Array<
		| {
				type: 'select';
				id: string;
				name: string;
				description?: string | null;
				category?: string | null;
				currentValue: string;
				options: Array<
					| { value: string; name: string; description?: string | null }
					| {
							groupId: string;
							name: string;
							options: Array<{ value: string; name: string; description?: string | null }>;
					  }
				>;
		  }
		| {
				type: 'boolean';
				id: string;
				name: string;
				description?: string | null;
				category?: string | null;
				currentValue: boolean;
		  }
	> | null;
	usage?: { used: number; size: number };
};
export type TranscriptMessage = {
	role: 'user' | 'assistant';
	text: string;
	images?: ImageAttachment[];
	attachments?: InputAttachment[];
	reviewContexts?: ReviewContext[];
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
	attachments: InputAttachment[];
	reviewContexts?: ReviewContext[];
};
export type QueuedMessage = {
	id: string;
	text: string;
	images: ImageAttachment[];
	attachments: InputAttachment[];
	reviewContexts: ReviewContext[];
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
	workMode?: WorkMode;
	activeTurn: ActiveTurn | null;
	events: SessionEvent[];
	messages: Array<{
		id: string;
		text: string;
		images: ImageAttachment[];
		attachments: InputAttachment[];
		reviewContexts: ReviewContext[];
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
