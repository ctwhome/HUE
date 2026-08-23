import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HermesProject } from './hermes-projects';
import { redactHermesValue } from './redaction';
import type { HUEStore } from './store';

type ProjectsClient = {
	list(): Promise<{ projects: HermesProject[]; activeId: string | null }>;
	create(input: {
		name: string;
		icon?: string | null;
		folders: string[];
		primaryPath: string;
	}): Promise<HermesProject>;
};

export type ProjectReconciliationIssue = {
	legacyProjectId: string;
	kind: 'ambiguous' | 'failed';
	message: string;
};

function canonical(path: string): string | null {
	try {
		return realpathSync(resolve(path));
	} catch {
		return null;
	}
}

export async function reconcileLegacyProjects(
	store: HUEStore,
	hermes: ProjectsClient
): Promise<{
	projects: HermesProject[];
	activeId: string | null;
	issues: ProjectReconciliationIssue[];
}> {
	const listed = await hermes.list();
	const projects = [...listed.projects];
	const issues: ProjectReconciliationIssue[] = [];
	const legacyProjects = store.listLegacyProjects().map((project) => ({
		project,
		canonicalRoot: canonical(project.rootPath)
	}));
	const matchMap = new Map(
		legacyProjects.map(({ project, canonicalRoot }) => [
			project.id,
			canonicalRoot
				? projects.filter((candidate) =>
						candidate.folders.some((folder) => canonical(folder.path) === canonicalRoot)
					)
				: []
		])
	);
	for (const { project: legacy, canonicalRoot: legacyRoot } of legacyProjects) {
		const matches = matchMap.get(legacy.id) ?? [];
		const collides = legacyProjects.some(
			(candidate) =>
				candidate.project.id !== legacy.id &&
				((legacyRoot !== null && candidate.canonicalRoot === legacyRoot) ||
					matches.some((match) =>
						(matchMap.get(candidate.project.id) ?? []).some(({ id }) => id === match.id)
					))
		);
		if (matches.length > 1 || collides) {
			issues.push({
				legacyProjectId: legacy.id,
				kind: 'ambiguous',
				message:
					matches.length > 1
						? `Legacy Project matches multiple Hermes Projects: ${matches.map(({ id }) => id).join(', ')}`
						: 'Multiple legacy Projects resolve to one Hermes Project or canonical folder'
			});
			continue;
		}
		try {
			const adopted =
				matches[0] ??
				(await hermes.create({
					name: legacy.name,
					icon: legacy.icon,
					folders: [legacyRoot ?? legacy.rootPath],
					primaryPath: legacyRoot ?? legacy.rootPath
				}));
			if (!projects.some(({ id }) => id === adopted.id)) projects.push(adopted);
			store.adoptHermesProject(legacy.id, adopted.id);
		} catch (cause) {
			issues.push({
				legacyProjectId: legacy.id,
				kind: 'failed',
				message: String(redactHermesValue(cause instanceof Error ? cause.message : String(cause)))
			});
		}
	}
	for (const project of projects) store.ensureProjectMetadata(project.id);
	return { projects, activeId: listed.activeId, issues };
}
