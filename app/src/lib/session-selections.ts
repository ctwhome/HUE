import type { WorkMode } from '$lib/work-mode';
import type { HermesRuntime } from '$lib/components/workspace/types';

const STORAGE_KEY = 'hue:last-session-selections';

export type LastSessionSelections = {
	modelId?: string;
	modeId?: string;
	workMode?: WorkMode;
};

type SessionSelectionStorage = Pick<Storage, 'getItem' | 'setItem'>;

function mergeRuntime(runtime: HermesRuntime, update: Partial<HermesRuntime>): HermesRuntime {
	const definedUpdate = Object.fromEntries(
		Object.entries(update).filter(([, value]) => value !== undefined)
	) as Partial<HermesRuntime>;
	return { ...runtime, ...definedUpdate };
}

export function readLastSessionSelections(storage: Pick<Storage, 'getItem'>): LastSessionSelections {
	try {
		const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
		return {
			...(typeof value.modelId === 'string' && value.modelId.trim()
				? { modelId: value.modelId.trim() }
				: {}),
			...(typeof value.modeId === 'string' && value.modeId.trim()
				? { modeId: value.modeId.trim() }
				: {}),
			...(value.workMode === 'autonomous' || value.workMode === 'live'
				? { workMode: value.workMode }
				: {})
		};
	} catch {
		return {};
	}
}

export function rememberLastSessionSelection(
	storage: SessionSelectionStorage,
	selection: LastSessionSelections
) {
	storage.setItem(
		STORAGE_KEY,
		JSON.stringify({ ...readLastSessionSelections(storage), ...selection })
	);
}

export async function applyLastSessionSelections({
	storage,
	runtime: initialRuntime,
	workMode: initialWorkMode,
	changeRuntime,
	changeWorkMode
}: {
	storage: Pick<Storage, 'getItem'>;
	runtime: HermesRuntime;
	workMode: WorkMode;
	changeRuntime: (
		kind: 'modelId' | 'modeId',
		value: string
	) => Promise<Partial<HermesRuntime>>;
	changeWorkMode: (value: WorkMode) => Promise<WorkMode>;
}) {
	const selections = readLastSessionSelections(storage);
	let runtime = initialRuntime;
	let workMode = initialWorkMode;
	if (
		selections.modelId &&
		selections.modelId !== runtime.models?.currentModelId &&
		runtime.models?.availableModels.some(({ modelId }) => modelId === selections.modelId)
	) {
		runtime = mergeRuntime(runtime, await changeRuntime('modelId', selections.modelId));
	}
	if (
		selections.modeId &&
		selections.modeId !== runtime.modes?.currentModeId &&
		runtime.modes?.availableModes.some(({ id }) => id === selections.modeId)
	) {
		runtime = mergeRuntime(runtime, await changeRuntime('modeId', selections.modeId));
	}
	if (selections.workMode && selections.workMode !== workMode) {
		workMode = await changeWorkMode(selections.workMode);
	}
	return { runtime, workMode };
}
