import { json } from '@sveltejs/kit';
import {
	HermesAdmin,
	type HermesAdminAction,
	type HermesAdminView
} from '$lib/server/hermes-admin';
import { redactHermesValue } from '$lib/server/redaction';
import { services } from '$lib/server/services';
import { requestAccessAllowed } from '$lib/server/access-auth';
import type { RequestHandler } from './$types';
import type { ScheduleService } from '$lib/server/schedule-service';

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

export async function _scheduleAction(
	schedules: ScheduleService,
	action: string,
	input: Record<string, unknown>
) {
	const id = typeof input.id === 'string' ? input.id : '';
	if (action === 'schedule.create') {
		return {
			target: await schedules.create({ name: input.name, prompt: input.prompt, cron: input.cron })
		};
	}
	if (action === 'schedule.update') {
		if (!input.updates || typeof input.updates !== 'object' || Array.isArray(input.updates)) {
			throw new Error('updates is required');
		}
		return { target: schedules.update(id, input.updates as Record<string, unknown>) };
	}
	if (action === 'schedule.pause') return { target: schedules.pause(id) };
	if (action === 'schedule.resume') return { target: schedules.resume(id) };
	if (action === 'schedule.run') {
		return {
			target: schedules.detail(id),
			delivery: schedules.runNow(id, String(input.runId ?? ''))
		};
	}
	if (action === 'schedule.delete') {
		if (input.confirm !== id) throw new Error(`Type ${id} to confirm deletion`);
		return { ...schedules.delete(id), verifiedAbsent: true };
	}
	throw new Error('Unknown schedule action');
}

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
		if (id && detail === 'schedule') return json(services().schedules.detail(id));
		if (id && (detail === 'skill' || detail === 'mcp')) {
			return json(await new HermesAdmin(services().admin).detail(detail, id));
		}
		return json(await new HermesAdmin(services().admin).view(view as HermesAdminView));
	} catch (cause) {
		return failure(cause, 503);
	}
};

export const POST: RequestHandler = async ({ request, url, getClientAddress }) => {
	if (!requestAccessAllowed(request, url, getClientAddress())) {
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
		if (body.action.startsWith('schedule.')) {
			return json(
				await _scheduleAction(
					services().schedules,
					body.action,
					body.input as Record<string, unknown>
				)
			);
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
