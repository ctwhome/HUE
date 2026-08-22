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
};

export type Job = {
	id: string;
	name?: string;
	schedule?: string;
	status: string;
	nextRun?: string;
	lastRun?: string;
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
	view: 'runtime' | 'skills' | 'schedules' | 'commands' | 'profiles' | 'mcp';
	label: string;
	description: string;
};
