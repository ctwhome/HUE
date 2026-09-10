import { json } from '@sveltejs/kit';
import { automaticSessionIcon } from '$lib/icon';
import { parseSessionHarness, sessionHarnessLabel } from '$lib/session-harness';
import type { ExternalCronProjection } from '$lib/server/external-cron-service';
import { redactHermesValue } from '$lib/server/redaction';
import {
	quickAskSessionRoot,
	services,
	sessionMatchesProjectRoot,
	unprojectedSessionRoot
} from '$lib/server/services';
import type { RequestHandler } from './$types';

async function listRuntimeSessions(root: string) {
	const runtime = services().sessionRuntime;
	const [hermes, opencode] = await Promise.all([
		runtime.listSessions(root),
		runtime.listSessions(root, 'opencode').catch(() => [])
	]);
	return [...hermes, ...opencode];
}

export const GET: RequestHandler = async ({ url }) => {
	const root = unprojectedSessionRoot();
	const quickRoot = quickAskSessionRoot();
	try {
		const requestedSessionId = url.searchParams.get('sessionId');
		if (requestedSessionId) {
			const stored =
				requestedSessionId.length <= 500
					? services().store.getSession(null, requestedSessionId)
					: null;
			if (!stored) return json({ sessions: [], hasMore: false });
			const busyStarts = services().store.getBusySessionStarts(null, [stored.sessionId]);
			const indicators = services().store.getSessionIndicators(null, 'all', [stored.sessionId]);
			const title = stored.title ?? `Untitled ${sessionHarnessLabel(stored.harness)} Session`;
			const available =
				sessionMatchesProjectRoot(root, stored.cwd) ||
				(services().store.isKeptQuickAskSession(stored.sessionId) &&
					sessionMatchesProjectRoot(quickRoot, stored.cwd));
			return json({
				sessions: [
					{
						...stored,
						title,
						icon: stored.icon ?? automaticSessionIcon(title),
						customIcon: stored.icon,
						available,
						recovery: available
							? null
							: `Restore the Session folder at ${stored.cwd} to resume it.`,
						busySince: busyStarts[stored.sessionId] ?? null,
						attention: indicators[stored.sessionId]?.attention ?? false,
						error: indicators[stored.sessionId]?.error ?? false,
						status: indicators[stored.sessionId]?.status ?? null,
						unreadAttention: indicators[stored.sessionId]?.unreadAttention ?? false
					}
				],
				hasMore: false
			});
		}
		const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0);
		const cached = url.searchParams.get('cached') === 'true' || offset > 0;
		const sessions = cached
			? []
			: [
					...(await listRuntimeSessions(root)).filter(
						(session) =>
							sessionMatchesProjectRoot(root, session.cwd) &&
							!services().store.isSessionDismissed(null, session.sessionId)
					),
					...(await listRuntimeSessions(quickRoot)).filter(
						(session) =>
							sessionMatchesProjectRoot(quickRoot, session.cwd) &&
							services().store.isKeptQuickAskSession(session.sessionId)
					)
				];
		for (const session of sessions) services().store.upsertSession(null, session);
		if (!cached) services().dispatcher.recover();
		const runtimeById = new Map(sessions.map((session) => [session.sessionId, session]));
		const query = url.searchParams.get('q')?.trim() ?? '';
		const includeArchived = url.searchParams.get('archived') === 'true';
		const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? 100) || 100, 100));
		const scope = url.searchParams.get('scope');
		let externalCronJobs: ExternalCronProjection['jobs'] = [];
		let externalCronError: unknown = null;
		if (scope === 'scheduled' && !cached) {
			try {
				externalCronJobs = (await services().externalCron.refreshSurface()).jobs;
			} catch (cause) {
				externalCronError = redactHermesValue(
					cause instanceof Error ? cause.message : String(cause)
				);
			}
		}
		const page = services().store.listSessionPage(null, {
			includeArchived,
			query,
			limit,
			offset,
			...(scope === 'scheduled' || scope === 'unscheduled' ? { scope } : {})
		});
		const ids = page.sessions.map(({ sessionId }) => sessionId);
		const busyStarts = services().store.getBusySessionStarts(null, ids);
		const indicators = services().store.getSessionIndicators(null, 'all', ids);
		return json({
			reconciliation: cached ? 'cached' : 'complete',
			externalCronJobs,
			externalCronError,
			sessions: page.sessions.map((stored) => {
				const runtime = runtimeById.get(stored.sessionId);
				const available =
					!!runtime ||
					sessionMatchesProjectRoot(root, stored.cwd) ||
					(services().store.isKeptQuickAskSession(stored.sessionId) &&
						sessionMatchesProjectRoot(quickRoot, stored.cwd));
				const title =
					stored.title ??
					runtime?.title ??
					`Untitled ${sessionHarnessLabel(stored.harness)} Session`;
				return {
					...runtime,
					...stored,
					title,
					icon: stored.icon ?? automaticSessionIcon(title),
					customIcon: stored.icon,
					available,
					recovery: available ? null : `Restore the Session folder at ${stored.cwd} to resume it.`,
					busySince: busyStarts[stored.sessionId] ?? null,
					attention: indicators[stored.sessionId]?.attention ?? false,
					error: indicators[stored.sessionId]?.error ?? false,
					status: indicators[stored.sessionId]?.status ?? null,
					unreadAttention: indicators[stored.sessionId]?.unreadAttention ?? false
				};
			}),
			hasMore: page.hasMore
		});
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 503 });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	const root = unprojectedSessionRoot();
	try {
		const text = await request.text();
		const body = text ? (JSON.parse(text) as { harness?: unknown }) : {};
		const harness = body.harness === undefined ? 'hermes' : parseSessionHarness(body.harness);
		if (!harness) return json({ error: 'Invalid Session harness' }, { status: 400 });
		const session = await services().sessionRuntime.createSession(root, harness);
		if (!sessionMatchesProjectRoot(root, session.cwd)) {
			throw new Error(
				`${sessionHarnessLabel(harness)} Session is outside the HUE session directory`
			);
		}
		services().store.upsertSession(null, session);
		const stored = services().store.getSession(null, session.sessionId)!;
		services().dispatcher.recover();
		return json(
			{
				session: {
					...session,
					...stored,
					icon: stored.icon ?? automaticSessionIcon(session.title),
					customIcon: stored.icon
				},
				commands: services().sessionRuntime.getAvailableCommands(session.sessionId),
				runtime: services().sessionRuntime.getSessionState(session.sessionId),
				branch: null
			},
			{ status: 201 }
		);
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 503 });
	}
};
