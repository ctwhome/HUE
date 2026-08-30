import { describe, expect, it } from 'bun:test';
import { HermesBundles } from './hermes-bundles';

const bundle = {
	name: 'Release',
	slug: 'release',
	description: 'Ship safely',
	skills: ['review', 'deploy'],
	instruction: 'Run every check.'
};

function transport(respond: (method: string, params: Record<string, unknown>) => unknown) {
	const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
	return {
		calls,
		request: async <T>(method: string, params: Record<string, unknown>) => {
			calls.push({ method, params });
			return respond(method, params) as T;
		}
	};
}

describe('HermesBundles', () => {
	it('uses profile-scoped bundles RPC and authoritative readback', async () => {
		const rpc = transport((method) =>
			method === 'bundles.list' ? { bundles: [bundle] } : { bundle }
		);
		const bundles = new HermesBundles(rpc, 'coder');

		expect(await bundles.list()).toEqual([bundle]);
		expect(await bundles.get('release')).toEqual(bundle);
		expect(
			await bundles.create({
				name: 'Release',
				description: 'Ship safely',
				skills: ['review', 'deploy'],
				instruction: 'Run every check.'
			})
		).toEqual(bundle);
		expect(await bundles.update('release', { skills: ['review'] })).toEqual(bundle);
		expect(await bundles.delete('release')).toEqual({ deleted: true });
		expect(rpc.calls).toEqual([
			{ method: 'bundles.list', params: { profile: 'coder' } },
			{ method: 'bundles.get', params: { profile: 'coder', slug: 'release' } },
			{
				method: 'bundles.create',
				params: {
					profile: 'coder',
					name: 'Release',
					description: 'Ship safely',
					skills: ['review', 'deploy'],
					instruction: 'Run every check.'
				}
			},
			{
				method: 'bundles.update',
				params: { profile: 'coder', slug: 'release', skills: ['review'] }
			},
			{ method: 'bundles.delete', params: { profile: 'coder', slug: 'release' } }
		]);
	});

	it('rejects invalid writes before RPC and invalid Hermes responses', async () => {
		const rpc = transport(() => ({ bundles: [{ ...bundle, skills: ['review', 4] }] }));
		const bundles = new HermesBundles(rpc, 'default');

		await expect(bundles.create({ name: 'Release', skills: [] })).rejects.toThrow(
			'at least one skill'
		);
		await expect(bundles.update('Release', {})).rejects.toThrow('No bundle changes supplied');
		await expect(bundles.list()).rejects.toThrow('invalid Bundle skill');
		expect(rpc.calls).toHaveLength(1);
	});

	it('surfaces skill permissions without returning skill content', async () => {
		const rpc = transport(() => ({}));
		const bundles = new HermesBundles(
			rpc,
			'default',
			async () => [
				{ name: 'review', description: 'Review code', enabled: true, content: 'do not return' }
			],
			() => ({ provenance: 'custom', editable: true })
		);

		expect(await bundles.listSkills()).toEqual([
			{
				name: 'review',
				description: 'Review code',
				enabled: true,
				provenance: 'custom',
				permissions: { read: true, write: true, delete: true }
			}
		]);
	});
});
