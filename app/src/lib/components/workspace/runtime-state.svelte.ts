import type { Api, HermesRuntime, Session } from './types';
import type { SessionState } from './session-state.svelte';

type RuntimeStateOptions = {
	api: Api;
	getSession: () => Session | null;
	sessionPath: (sessionId: string) => string;
	session: SessionState;
	setError: (message: string) => void;
	rememberSelection: (selection: { modelId?: string; modeId?: string }) => void;
};

export class RuntimeState {
	changing = $state(false);

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
		if (!selectedSession) return;
		this.changing = true;
		try {
			const body = await this.options.api<{ runtime: HermesRuntime }>(
				this.options.sessionPath(selectedSession.sessionId),
				{ method: 'PATCH', body: JSON.stringify({ [kind]: value }) }
			);
			this.options.session.runtime = { ...this.options.session.runtime, ...body.runtime };
			this.options.rememberSelection({ [kind]: value });
		} catch (cause) {
			this.options.setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			this.changing = false;
		}
	};

	changeConfig = async (configId: string, configValue: string | boolean) => {
		const selectedSession = this.options.getSession();
		if (!selectedSession) return;
		this.changing = true;
		try {
			const body = await this.options.api<{ runtime: HermesRuntime }>(
				this.options.sessionPath(selectedSession.sessionId),
				{ method: 'PATCH', body: JSON.stringify({ configId, configValue }) }
			);
			this.options.session.runtime = { ...this.options.session.runtime, ...body.runtime };
		} catch (cause) {
			this.options.setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			this.changing = false;
		}
	};

	selectModel = (modelId: string) => {
		void this.change('modelId', modelId);
	};
}
