export type Command = { name: string; description: string };

export type HermesInfo = {
	profile: string;
	protocolVersion?: number;
	agent?: { name: string; version: string };
	capabilities?: Record<string, unknown>;
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
	profile: string;
	name?: string;
	schedule?: string;
	status: string;
	nextRun?: string;
	lastRun?: string;
	prompt?: string;
	deliver?: string;
	last_status?: string;
	last_error?: string;
	last_delivery_error?: string;
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
