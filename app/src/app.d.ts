// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		interface PageState {
			hueWorkspace?: boolean;
			drawerEntry?: boolean;
			projectId?: string | null;
			sessionId?: string | null;
			pane?: import('$lib/components/workspace/mobile-navigation').MobilePane;
		}
		// interface Platform {}
	}
}

export {};
