export class DirtyGuard {
	dirty = false;
	open = false;
	private readonly sources = new Map<symbol, { dirty: boolean; discard: () => void }>();
	private pending: (() => void) | null = null;

	constructor(private readonly onChange: (guard: DirtyGuard) => void = () => undefined) {}

	register(discard: () => void) {
		const id = Symbol();
		this.sources.set(id, { dirty: false, discard });
		return {
			setDirty: (dirty: boolean) => {
				const source = this.sources.get(id);
				if (!source || source.dirty === dirty) return;
				source.dirty = dirty;
				this.syncDirty();
			},
			unregister: () => {
				if (!this.sources.delete(id)) return;
				this.syncDirty();
			}
		};
	}

	private syncDirty() {
		this.dirty = [...this.sources.values()].some((source) => source.dirty);
		this.onChange(this);
	}

	block(action: () => void) {
		if (!this.dirty) return false;
		this.pending = action;
		this.open = true;
		this.onChange(this);
		return true;
	}

	keepEditing() {
		this.open = false;
		this.pending = null;
		this.onChange(this);
	}

	discardAndContinue() {
		const action = this.pending;
		this.pending = null;
		const dirtySources = [...this.sources.values()].filter((source) => source.dirty);
		for (const source of dirtySources) source.discard();
		for (const source of dirtySources) source.dirty = false;
		this.dirty = false;
		this.open = false;
		this.onChange(this);
		action?.();
	}
}
