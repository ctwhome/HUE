import { beforeNavigate, goto } from '$app/navigation';
import type { DirtyGuard } from './dirty-guard';

export function installDirtyNavigation(guard: DirtyGuard, flush: () => void = () => undefined) {
	beforeNavigate((navigation) => {
		flush();
		if (!navigation.to || !guard.dirty) return;
		navigation.cancel();
		guard.block(() => {
			if (navigation.to?.route.id) void goto(navigation.to.url);
			else if (navigation.to) window.location.assign(navigation.to.url);
		});
	});
}
