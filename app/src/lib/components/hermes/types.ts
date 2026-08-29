export type Command = { name: string; description: string };

export type HermesInfo = {
	profile: string;
	protocolVersion?: number;
	agent?: { name: string; version: string };
	capabilities?: Record<string, unknown>;
	clarify?: { status: 'unsupported' | 'available'; reason?: string };
};

export type Skill = {
	name: string;
	category: string;
	source: string;
	trust?: string;
	status: string;
	description?: string;
	provenance?: string;
	enabled?: boolean;
};

export type Job = {
	id: string;
	name: string;
	cron: string;
	enabled: boolean;
	status: string;
	nextRun?: string;
	prompt: string;
	sessionId: string;
};

export type Profile = { name: string; model: string; gateway: string; active: boolean };

export type McpServer = {
	name: string;
	transport: string;
	url: string | null;
	command: string | null;
	enabled: boolean;
};

export type HermesSection = {
	view: 'runtime' | 'memory' | 'skills' | 'schedules' | 'commands' | 'profiles' | 'mcp' | 'models';
	label: string;
	description: string;
};
