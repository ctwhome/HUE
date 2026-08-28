import type { Api, Project, Session, SessionLoad } from './types';

type PreloadTarget = { projectId: string; session: Session };

export async function preloadSessionViews(
	projects: Project[],
	api: Api,
	cache: (projectId: string, sessionId: string, body: SessionLoad) => void,
	signal?: AbortSignal
) {
	const targets = (
		await Promise.all(
			projects
				.filter(({ rootAvailable }) => rootAvailable)
				.map(async ({ id: projectId }) => {
					const sessions: Session[] = [];
					try {
						for (let offset = 0; ; ) {
							if (signal?.aborted) return [];
							const query = new URLSearchParams({ cached: 'true' });
							if (offset) {
								query.set('limit', '100');
								query.set('offset', String(offset));
							}
							const page = await api<{ sessions: Session[]; hasMore?: boolean }>(
								`/api/projects/${encodeURIComponent(projectId)}/sessions?${query}`,
								{ signal }
							);
							sessions.push(...page.sessions.filter(({ archived }) => !archived));
							if (!page.hasMore || !page.sessions.length) break;
							offset += page.sessions.length;
						}
					} catch {
						return [];
					}
					return sessions.map((session) => ({ projectId, session }));
				})
		)
	).flat() as PreloadTarget[];

	let next = 0;
	const worker = async () => {
		while (!signal?.aborted) {
			const target = targets[next++];
			if (!target) return;
			try {
				const body = await api<SessionLoad>(
					`/api/projects/${encodeURIComponent(target.projectId)}/sessions/${encodeURIComponent(target.session.sessionId)}`,
					{ signal }
				);
				if (!signal?.aborted) cache(target.projectId, target.session.sessionId, body);
			} catch {
				// One unavailable Session must not block the remaining cache warmup.
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(3, targets.length) }, worker));
}
