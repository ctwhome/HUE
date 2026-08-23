import { describe, expect, it } from 'bun:test';
import { ProjectOperations } from './project-operations';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => (resolve = done));
	return { promise, resolve };
}

describe('ProjectOperations', () => {
	it('message accepted first blocks archive, which then sees active delivery', async () => {
		const accepted = deferred();
		const release = deferred();
		let active = false;
		const operations = new ProjectOperations<{ id: string; archived: boolean }>({
			resolve: async () => ({ id: 'canonical', archived: false }),
			active: () => active,
			archive: async () => ({ id: 'canonical', archived: true })
		});
		const message = operations.message('slug', async (project) => {
			active = true;
			accepted.resolve();
			await release.promise;
			return project.id;
		});
		await accepted.promise;
		const archive = operations.archive('slug');
		release.resolve();

		expect(await message).toBe('canonical');
		await expect(archive).rejects.toThrow('active message deliveries');
		expect(operations.size).toBe(0);
	});

	it('archive accepted first makes waiting message see archived state', async () => {
		const archiving = deferred();
		const release = deferred();
		let archived = false;
		const operations = new ProjectOperations<{ id: string; archived: boolean }>({
			resolve: async () => ({ id: 'canonical', archived }),
			active: () => false,
			archive: async () => {
				archiving.resolve();
				await release.promise;
				archived = true;
				return { id: 'canonical', archived: true };
			}
		});
		const archive = operations.archive('slug');
		await archiving.promise;
		let submitted = false;
		const message = operations.message('slug', () => {
			submitted = true;
		});
		release.resolve();

		expect(await archive).toMatchObject({ id: 'canonical', archived: true });
		await expect(message).rejects.toThrow('Project not found');
		expect(submitted).toBe(false);
		expect(operations.size).toBe(0);
	});
});
