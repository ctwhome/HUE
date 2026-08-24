import { describe, expect, it } from 'bun:test';
import {
	applyLastSessionSelections,
	readLastSessionSelections,
	rememberLastSessionSelection
} from './session-selections';

function memoryStorage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value)
	};
}

describe('last Session selections', () => {
	it('persists each successful selection without losing the others', () => {
		const storage = memoryStorage();

		rememberLastSessionSelection(storage, { modelId: 'openai:gpt-5.6-sol' });
		rememberLastSessionSelection(storage, { modeId: 'accept-edits' });
		rememberLastSessionSelection(storage, { workMode: 'live' });

		expect(readLastSessionSelections(storage)).toEqual({
			modelId: 'openai:gpt-5.6-sol',
			modeId: 'accept-edits',
			workMode: 'live'
		});
	});

	it('applies available persisted selections to a newly created Session', async () => {
		const changes: Array<[string, string]> = [];
		const result = await applyLastSessionSelections({
			storage: memoryStorage({
				'hue:last-session-selections': JSON.stringify({
					modelId: 'openai:gpt-5.6-sol',
					modeId: 'accept-edits',
					workMode: 'live'
				})
			}),
			runtime: {
				profile: 'default',
				models: {
					currentModelId: 'openai:gpt-5.6-mini',
					availableModels: [
						{ modelId: 'openai:gpt-5.6-mini', name: 'Mini' },
						{ modelId: 'openai:gpt-5.6-sol', name: 'GPT 5.6 Sol' }
					]
				},
				modes: {
					currentModeId: 'ask',
					availableModes: [
						{ id: 'ask', name: 'Ask' },
						{ id: 'accept-edits', name: 'Accept Edits' }
					]
				}
			},
			workMode: 'autonomous',
			changeRuntime: async (kind, value) => {
				changes.push([kind, value]);
				return {
					models:
						kind === 'modelId'
							? { currentModelId: value, availableModels: [] }
							: undefined,
					modes:
						kind === 'modeId'
							? { currentModeId: value, availableModes: [] }
							: undefined
				};
			},
			changeWorkMode: async (value) => {
				changes.push(['workMode', value]);
				return value;
			}
		});

		expect(changes).toEqual([
			['modelId', 'openai:gpt-5.6-sol'],
			['modeId', 'accept-edits'],
			['workMode', 'live']
		]);
		expect(result.runtime.models?.currentModelId).toBe('openai:gpt-5.6-sol');
		expect(result.runtime.modes?.currentModeId).toBe('accept-edits');
		expect(result.workMode).toBe('live');
	});
});
