import { describe, expect, test } from 'bun:test';
import { sessionInspectorRows } from './session-inspector';

describe('session inspector rows', () => {
	test('discloses only context proven by current props', () => {
		expect(
			sessionInspectorRows({
				project: { name: 'HUE' },
				session: { cwd: '/Users/ctw/Sites/HUE/app', workMode: 'live', harness: 'hermes' },
				runtime: {
					profile: 'default',
					models: {
						currentModelId: 'claude-sonnet',
						availableModels: [{ modelId: 'claude-sonnet', name: 'Claude Sonnet' }]
					},
					modes: {
						currentModeId: 'suggest',
						availableModes: [{ id: 'suggest', name: 'Suggest edits' }]
					},
					configOptions: [
						{
							type: 'select',
							id: 'thought',
							name: 'Reasoning',
							category: 'thought_level',
							currentValue: 'high',
							options: [{ value: 'high', name: 'High' }]
						}
					],
					usage: { used: 250, size: 1000 },
					clarify: { status: 'available' }
				},
				delivery: 'running',
				pendingInteraction: 'Permission: Run checks',
				workflowName: 'Release'
			})
		).toEqual([
			{ label: 'Project', value: 'HUE' },
			{ label: 'Harness', value: 'Hermes' },
			{ label: 'Path', value: '/Users/ctw/Sites/HUE/app', code: true },
			{ label: 'Work mode', value: 'Live' },
			{ label: 'Workflow', value: 'Release' },
			{ label: 'Model', value: 'Claude Sonnet' },
			{ label: 'Reasoning', value: 'High' },
			{ label: 'Edit mode', value: 'Suggest edits' },
			{ label: 'Context', value: '25% (250 of 1,000 tokens)' },
			{ label: 'Delivery', value: 'Running' },
			{ label: 'Pending interaction', value: 'Permission: Run checks' },
			{ label: 'Hermes profile', value: 'default' },
			{ label: 'Clarification capability', value: 'Available' }
		]);
	});

	test('labels OpenCode without presenting a Hermes profile', () => {
		const rows = sessionInspectorRows({
			project: null,
			session: { harness: 'opencode' },
			runtime: { profile: 'default', harness: 'opencode' },
			delivery: ''
		});

		expect(rows).toEqual([{ label: 'Harness', value: 'OpenCode' }]);
	});

	test('does not infer connection, health, workflow, or optional runtime values', () => {
		expect(
			sessionInspectorRows({
				project: null,
				session: {},
				runtime: { profile: '' },
				delivery: ''
			})
		).toEqual([]);
	});

	test('reports only explicit connection trouble', () => {
		expect(
			sessionInspectorRows({
				project: null,
				session: {},
				runtime: { profile: 'default' },
				delivery: 'reconnecting'
			})
		).toContainEqual({ label: 'Connection', value: 'Reconnecting' });
	});
});
