import { json } from '@sveltejs/kit';
import { localApiAllowed } from '$lib/server/local-api';
import { createHueBackup, runtimeDiagnostics } from '$lib/server/runtime-reliability';
import { services } from '$lib/server/services';
import type { RequestHandler } from './$types';

type RuntimeHandler = (event: {
	request: Request;
	url: URL;
	getClientAddress(): string;
}) => Promise<Response>;

export function _createRuntimeHandlers(dependencies: {
	diagnostics: () => Promise<unknown>;
	backup: () => { filename: string; path: string; validated: true };
}): { GET: RuntimeHandler; POST: RuntimeHandler } {
	const allowed = ({ request, url, getClientAddress }: Parameters<RuntimeHandler>[0]) =>
		localApiAllowed(request, url, getClientAddress());
	return {
		GET: async (event) => {
			if (!allowed(event))
				return json({ error: 'API access is limited to this device' }, { status: 403 });
			return json(await dependencies.diagnostics());
		},
		POST: async (event) => {
			if (!allowed(event))
				return json({ error: 'API access is limited to this device' }, { status: 403 });
			try {
				return json({ backup: dependencies.backup() }, { status: 201 });
			} catch (cause) {
				return json(
					{ error: cause instanceof Error ? cause.message : 'Backup failed' },
					{ status: 500 }
				);
			}
		}
	};
}

const handlers = _createRuntimeHandlers({
	diagnostics: () => runtimeDiagnostics(services()),
	backup: () => createHueBackup(services().store)
});

export const GET: RequestHandler = handlers.GET;
export const POST: RequestHandler = handlers.POST;
