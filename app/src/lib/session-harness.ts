export const SESSION_HARNESSES = ['hermes', 'opencode'] as const;
export type SessionHarness = (typeof SESSION_HARNESSES)[number];

export function parseSessionHarness(value: unknown): SessionHarness | null {
	return typeof value === 'string' && SESSION_HARNESSES.includes(value as SessionHarness)
		? (value as SessionHarness)
		: null;
}

export function sessionHarnessLabel(harness: SessionHarness): string {
	return harness === 'opencode' ? 'OpenCode' : 'Hermes';
}
