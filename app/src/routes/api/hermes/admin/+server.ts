import { json } from '@sveltejs/kit';
import {
	HermesAdmin,
	type HermesAdminAction,
	type HermesAdminView
} from '$lib/server/hermes-admin';
import { redactHermesValue } from '$lib/server/redaction';
import { services } from '$lib/server/services';
import { localApiAllowed } from '$lib/server/local-api';
import type { RequestHandler } from './$types';

const views = new Set(['runtime', 'memory', 'schedules', 'skills', 'profiles', 'mcp', 'models']);
const actions = new Set([
	'schedule.create',
	'schedule.update',
	'schedule.pause',
	'schedule.resume',
	'schedule.run',
	'schedule.delete',
	'skill.create',
	'skill.toggle',
	'profile.create',
	'profile.switch',
	'profile.delete',
	'profile.model',
	'mcp.create',
	'mcp.toggle',
	'mcp.test',
	'mcp.auth',
	'mcp.auth.status',
	'mcp.auth.cancel',
	'mcp.delete',
	'model.set'
]);

function failure(cause: unknown, status = 400) {
	return json(
		{ error: redactHermesValue(cause instanceof Error ? cause.message : String(cause)) },
		{ status }
	);
}

export const GET: RequestHandler = async ({ url }) => {
	try {
		const view = url.searchParams.get('view');
		if (!view || !views.has(view)) return failure('Unknown Hermes administration view');
		const id = url.searchParams.get('id');
		const detail = url.searchParams.get('detail');
		if (id && (detail === 'schedule' || detail === 'skill' || detail === 'mcp')) {
			return json(
				await new HermesAdmin(services().admin).detail(
					detail,
					id,
					url.searchParams.get('profile') ?? undefined
				)
			);
		}
		return json(await new HermesAdmin(services().admin).view(view as HermesAdminView));
	} catch (cause) {
		return failure(cause, 503);
	}
};

export const POST: RequestHandler = async ({ request, url, getClientAddress }) => {
	if (!localApiAllowed(request, url, getClientAddress())) {
		return json({ error: 'API access is limited to this device' }, { status: 403 });
	}
	try {
		const body = (await request.json()) as { action?: unknown; input?: unknown };
		if (body.action === 'runtime.restart-admin') {
			if ((body.input as { confirm?: unknown } | null)?.confirm !== 'restart') {
				return failure('Type restart to confirm Hermes admin restart');
			}
			await services().admin.close();
			await services().admin.start();
			return json(redactHermesValue({ target: { admin: services().admin.healthStatus() } }));
		}
		if (body.action === 'runtime.reconnect-acp') {
			if ((body.input as { confirm?: unknown } | null)?.confirm !== 'reconnect') {
				return failure('Type reconnect to confirm Hermes ACP reconnect');
			}
			await services().runtime.close();
			await services().runtime.start();
			return json(redactHermesValue({ target: services().runtime.getRuntimeInfo() }));
		}
		if (typeof body.action !== 'string' || !actions.has(body.action)) {
			return failure('Unknown Hermes administration action');
		}
		if (!body.input || typeof body.input !== 'object' || Array.isArray(body.input)) {
			return failure('input is required');
		}
		return json(
			await new HermesAdmin(services().admin).mutate(
				body.action as HermesAdminAction,
				body.input as Record<string, unknown>
			)
		);
	} catch (cause) {
		return failure(cause);
	}
};
