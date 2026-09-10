import type { Api, HermesRuntime, Session } from './types';
import type { SessionState } from './session-state.svelte';

type RuntimeStateOptions = {
	api: Api;
	getSession: () => Session | null;
	captureSelection: () => unknown;
	isCurrentSelection: (selection: unknown) => boolean;
	sessionPath: (sessionId: string) => string;
	session: SessionState;
	setError: (message: string) => void;
	rememberSelection: (selection: { modelId?: string; modeId?: string }) => void;
};

export class RuntimeState {
	private changingValue = $state(false);
	get changing() {
		return this.changingValue && this.options.isCurrentSelection(this.changingSelection);
	}
	private changingSelection = $state<unknown>(undefined);

	constructor(private options: RuntimeStateOptions) {}

	contextPercent = () => {
		const usage = this.options.session.runtime.usage;
		if (!usage?.size) return null;
		return Math.max(0, Math.min(100, Math.round((usage.used / usage.size) * 100)));
	};

	currentModel = () =>
		this.options.session.runtime.models?.availableModels.find(
			(model) => model.modelId === this.options.session.runtime.models?.currentModelId
		);

	change = async (kind: 'modelId' | 'modeId', value: string) => {
		const selectedSession = this.options.getSession();
		if (
			!selectedSession ||
			(this.changing && this.options.isCurrentSelection(this.changingSelection))
		)
			return;
		const selection = this.options.captureSelection();
		this.changingSelection = selection;
		this.changingValue = true;
		try {
			const body = await this.options.api<{ runtime: HermesRuntime }>(
				this.options.sessionPath(selectedSession.sessionId),
				{ method: 'PATCH', body: JSON.stringify({ [kind]: value }) }
			);
			if (!this.options.isCurrentSelection(selection)) return;
			this.options.session.runtime = { ...this.options.session.runtime, ...body.runtime };
			this.options.rememberSelection({ [kind]: value });
		} catch (cause) {
			if (this.options.isCurrentSelection(selection))
				this.options.setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			if (this.options.isCurrentSelection(selection)) this.changingValue = false;
		}
	};

	changeConfig = async (configId: string, configValue: string | boolean) => {
		const selectedSession = this.options.getSession();
		if (
			!selectedSession ||
			(this.changing && this.options.isCurrentSelection(this.changingSelection))
		)
			return;
		const selection = this.options.captureSelection();
		this.changingSelection = selection;
		this.changingValue = true;
		try {
			const body = await this.options.api<{ runtime: HermesRuntime }>(
				this.options.sessionPath(selectedSession.sessionId),
				{ method: 'PATCH', body: JSON.stringify({ configId, configValue }) }
			);
			if (!this.options.isCurrentSelection(selection)) return;
			this.options.session.runtime = { ...this.options.session.runtime, ...body.runtime };
		} catch (cause) {
			if (this.options.isCurrentSelection(selection))
				this.options.setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			if (this.options.isCurrentSelection(selection)) this.changingValue = false;
		}
	};

	selectModel = (modelId: string) => {
		void this.change('modelId', modelId);
	};
}
