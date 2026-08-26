import { workModeLabel, type WorkMode } from '$lib/work-mode';
import type { HermesRuntime } from './types';

export type InspectorRow = { label: string; value: string; code?: true };

type InspectorInput = {
	project: { name: string } | null;
	session: { cwd?: string; workMode?: WorkMode };
	runtime: HermesRuntime;
	delivery: string;
	pendingInteraction?: string;
	workflowName?: string;
};

const label = (value: string) =>
	value.charAt(0).toUpperCase() + value.slice(1).replaceAll('-', ' ');

export function sessionInspectorRows(input: InspectorInput): InspectorRow[] {
	const rows: InspectorRow[] = [];
	if (input.project) rows.push({ label: 'Project', value: input.project.name });
	if (input.session.cwd) rows.push({ label: 'Path', value: input.session.cwd, code: true });
	if (input.session.workMode)
		rows.push({ label: 'Work mode', value: workModeLabel(input.session.workMode) });
	if (input.workflowName) rows.push({ label: 'Workflow', value: input.workflowName });

	const models = input.runtime.models;
	if (models?.currentModelId) {
		rows.push({
			label: 'Model',
			value:
				models.availableModels.find(({ modelId }) => modelId === models.currentModelId)?.name ??
				models.currentModelId
		});
	}
	const reasoning = input.runtime.configOptions?.find(
		(option) => option.type === 'select' && option.category === 'thought_level'
	);
	if (reasoning?.type === 'select') {
		const options = reasoning.options.flatMap((option) =>
			'value' in option ? [option] : option.options
		);
		rows.push({
			label: 'Reasoning',
			value:
				options.find(({ value }) => value === reasoning.currentValue)?.name ??
				reasoning.currentValue
		});
	}
	const modes = input.runtime.modes;
	if (modes?.currentModeId) {
		rows.push({
			label: 'Edit mode',
			value:
				modes.availableModes.find(({ id }) => id === modes.currentModeId)?.name ??
				modes.currentModeId
		});
	}
	if (input.runtime.usage?.size) {
		const { used, size } = input.runtime.usage;
		rows.push({
			label: 'Context',
			value: `${Math.max(0, Math.min(100, Math.round((used / size) * 100)))}% (${used.toLocaleString()} of ${size.toLocaleString()} tokens)`
		});
	}
	if (input.delivery) rows.push({ label: 'Delivery', value: label(input.delivery) });
	if (input.delivery === 'reconnecting') rows.push({ label: 'Connection', value: 'Reconnecting' });
	if (input.delivery === 'delivery unknown') rows.push({ label: 'Connection', value: 'Unknown' });
	if (input.pendingInteraction)
		rows.push({ label: 'Pending interaction', value: input.pendingInteraction });
	if (input.runtime.profile) rows.push({ label: 'Hermes profile', value: input.runtime.profile });
	if (input.runtime.clarify)
		rows.push({
			label: 'Clarification capability',
			value: label(input.runtime.clarify.status)
		});
	return rows;
}
