import type { CapacitorConfig } from '@capacitor/cli';

function hueServerUrl(value = process.env.HUE_SERVER_URL ?? 'http://10.0.2.2:4173'): string {
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch (error) {
		throw new Error('HUE_SERVER_URL must be an absolute origin URL', { cause: error });
	}
	const host = url.hostname.toLowerCase().replace(/\.+$/, '');
	if (
		!host ||
		url.username ||
		url.password ||
		(url.pathname !== '' && url.pathname !== '/') ||
		url.search ||
		url.hash
	) {
		throw new Error('HUE_SERVER_URL must contain only scheme, host, and optional port');
	}
	const loopback = host === '10.0.2.2' || host === '127.0.0.1' || host === 'localhost';
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
		throw new Error('HUE_SERVER_URL must use HTTPS, or debug-only loopback HTTP');
	}
	if (host === 'invalid' || host.endsWith('.invalid')) {
		throw new Error('HUE_SERVER_URL must not use reserved .invalid');
	}
	return `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}`;
}

const serverUrl = hueServerUrl();

const config: CapacitorConfig = {
	appId: 'studio.ctw.hue',
	appName: 'HUE',
	webDir: 'native-web',
	server: {
		url: serverUrl,
		cleartext: serverUrl.startsWith('http://')
	},
	android: {
		allowMixedContent: false
	}
};

export default config;
