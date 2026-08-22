export class DirtyGuard {
	dirty = false;
	open = false;
	private discard: (() => void) | null = null;
	private pending: (() => void) | null = null;

	constructor(private readonly onChange: (guard: DirtyGuard) => void = () => undefined) {}

	register(discard: () => void) {
		this.discard = discard;
		return () => {
			if (this.discard === discard) this.discard = null;
		};
	}

	setDirty(value: boolean) {
		this.dirty = value;
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
		this.discard?.();
		this.dirty = false;
		this.open = false;
		this.onChange(this);
		action?.();
	}
}
