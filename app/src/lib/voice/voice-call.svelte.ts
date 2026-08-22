import { tick } from 'svelte';
import { takeSpeakableText } from '$lib/voice-call';

type SessionEvent = { sequence: number; type: string; payload: Record<string, unknown> };
type CallStatus = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking';

type VoiceCallOptions = {
	hasSession: () => boolean;
	isBusy: () => boolean;
	sendText: (text: string) => Promise<boolean>;
	stopTurn: () => Promise<void>;
	focusComposer: () => void;
	reportError: (message: string) => void;
};

export function createVoiceCall(options: VoiceCallOptions) {
	let active = $state(false);
	let messageOnly = $state(false);
	let muted = $state(false);
	let status = $state<CallStatus>('idle');
	let error = $state('');
	let startElement = $state<HTMLButtonElement>();
	let messageElement = $state<HTMLButtonElement>();
	let muteElement = $state<HTMLButtonElement>();
	let cancelElement = $state<HTMLButtonElement>();
	let stream: MediaStream | null = null;
	let streamPromise: Promise<MediaStream> | null = null;
	let recorder: MediaRecorder | null = null;
	let monitor: ReturnType<typeof setInterval> | null = null;
	let monitorContext: AudioContext | null = null;
	let speechContext: AudioContext | null = null;
	let audio: HTMLAudioElement | null = null;
	let speechAbort: AbortController | null = null;
	let transcribeAbort: AbortController | null = null;
	let generation = 0;
	const discardedRecorders = new WeakSet<MediaRecorder>();
	let responseText = '';
	let spokenOffset = 0;
	let speechQueue = Promise.resolve();

	function stopPlayback() {
		speechAbort?.abort();
		speechAbort = null;
		void speechContext?.close().catch(() => undefined);
		speechContext = null;
		if (audio) {
			audio.pause();
			audio.src = '';
			audio = null;
		}
	}

	function stopMonitor() {
		if (monitor) clearInterval(monitor);
		monitor = null;
		void monitorContext?.close().catch(() => undefined);
		monitorContext = null;
	}

	function stopRecording(discard = true) {
		stopMonitor();
		if (recorder?.state === 'recording') {
			if (discard) discardedRecorders.add(recorder);
			recorder.stop();
		}
	}

	function isRecording() {
		return recorder?.state === 'recording';
	}

	function blobDataUrl(blob: Blob): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(blob);
		});
	}

	async function transcribe(blob: Blob, currentGeneration: number) {
		if (!active || muted || currentGeneration !== generation) return;
		status = 'transcribing';
		const abort = new AbortController();
		transcribeAbort = abort;
		try {
			const dataUrl = await blobDataUrl(blob);
			if (!active || muted || currentGeneration !== generation || abort.signal.aborted) return;
			const response = await fetch('/api/voice/transcribe', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ dataUrl, mimeType: blob.type || 'audio/webm' }),
				signal: abort.signal
			});
			const result = (await response.json()) as { text?: string; error?: string };
			if (!response.ok)
				throw new Error(result.error ?? `Transcription failed (${response.status})`);
			if (!active || currentGeneration !== generation) return;
			const text = (result.text ?? '').trim();
			if (!text) return void beginListening();
			if (/^(?:stop|end call|goodbye)$/i.test(text.replace(/[.!?]+$/, ''))) {
				end();
				return;
			}
			if (messageOnly) {
				end(false);
				await options.sendText(text);
				await tick();
				options.focusComposer();
				return;
			}
			if (!(await options.sendText(text))) void beginListening();
		} catch (cause) {
			if (!abort.signal.aborted) error = cause instanceof Error ? cause.message : String(cause);
			if (active && currentGeneration === generation) void beginListening();
		} finally {
			if (transcribeAbort === abort) transcribeAbort = null;
		}
	}

	async function beginListening() {
		if (!active || muted || options.isBusy() || isRecording()) return;
		const currentGeneration = generation;
		let acquisition: Promise<MediaStream> | null = null;
		try {
			let currentStream = stream;
			if (!currentStream) {
				acquisition =
					streamPromise ??
					(streamPromise = navigator.mediaDevices.getUserMedia({
						audio: { echoCancellation: true, noiseSuppression: true }
					}));
				currentStream = await acquisition;
				if (streamPromise === acquisition) streamPromise = null;
				if (!active || muted || currentGeneration !== generation) {
					currentStream.getTracks().forEach((track) => track.stop());
					return;
				}
				stream = currentStream;
			}
			if (isRecording()) return;
			currentStream.getAudioTracks().forEach((track) => (track.enabled = true));
			const currentRecorder = new MediaRecorder(currentStream);
			const chunks: Blob[] = [];
			recorder = currentRecorder;
			currentRecorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
			currentRecorder.onstop = () => {
				if (recorder === currentRecorder) recorder = null;
				const discard = discardedRecorders.has(currentRecorder);
				if (!discard && chunks.length) {
					void transcribe(new Blob(chunks, { type: currentRecorder.mimeType }), currentGeneration);
				} else if (active && !muted && currentGeneration === generation) {
					void beginListening();
				}
			};
			currentRecorder.start();
			error = '';
			status = 'listening';

			const context = new AudioContext();
			const source = context.createMediaStreamSource(currentStream);
			const analyser = context.createAnalyser();
			analyser.fftSize = 512;
			source.connect(analyser);
			monitorContext = context;
			const samples = new Uint8Array(analyser.fftSize);
			const startedAt = Date.now();
			let heardSpeech = false;
			let silentSince = 0;
			monitor = setInterval(() => {
				analyser.getByteTimeDomainData(samples);
				const rms = Math.sqrt(
					samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / samples.length
				);
				if (rms > 0.04) {
					heardSpeech = true;
					silentSince = 0;
				} else if (heardSpeech) {
					silentSince ||= Date.now();
					if (Date.now() - silentSince >= 1_250) stopRecording(false);
				} else if (Date.now() - startedAt >= 12_000) {
					stopRecording(true);
				}
			}, 100);
		} catch (cause) {
			if (streamPromise === acquisition) streamPromise = null;
			if (!active || currentGeneration !== generation) return;
			error = cause instanceof Error ? cause.message : String(cause);
			options.reportError(error);
			end();
		}
	}

	async function playSpeech(text: string, currentGeneration: number) {
		if (!text.trim() || !active || currentGeneration !== generation) return;
		error = '';
		status = 'speaking';
		const abort = new AbortController();
		speechAbort = abort;
		try {
			const response = await fetch('/api/voice/speak', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text }),
				signal: abort.signal
			});
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as { error?: string } | null;
				throw new Error(body?.error ?? `Speech failed (${response.status})`);
			}
			if (response.headers.get('content-type')?.startsWith('audio/L16')) {
				await playPcm(response, abort.signal);
			} else {
				await playAudio(response, abort.signal);
			}
		} catch (cause) {
			if (!abort.signal.aborted) error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			if (speechAbort === abort) speechAbort = null;
		}
	}

	async function playAudio(response: Response, signal: AbortSignal) {
		const url = URL.createObjectURL(await response.blob());
		const currentAudio = new Audio(url);
		audio = currentAudio;
		try {
			await new Promise<void>((resolve, reject) => {
				const stop = () => {
					currentAudio.pause();
					resolve();
				};
				signal.addEventListener('abort', stop, { once: true });
				currentAudio.onended = () => resolve();
				currentAudio.onerror = () => reject(new Error('Speech playback failed'));
				void currentAudio.play().catch(reject);
			});
		} finally {
			URL.revokeObjectURL(url);
			if (audio === currentAudio) audio = null;
		}
	}

	async function playPcm(response: Response, signal: AbortSignal) {
		if (!response.body) throw new Error('Hermes returned no speech audio');
		const sampleRate = Number(response.headers.get('x-audio-sample-rate')) || 24_000;
		const context = new AudioContext();
		speechContext = context;
		try {
			const reader = response.body.getReader();
			let nextStart = context.currentTime;
			let carry: Uint8Array | null = null;
			while (!signal.aborted) {
				const { done, value } = await reader.read();
				if (done) break;
				let bytes = value;
				if (carry) {
					const joined = new Uint8Array(carry.length + bytes.length);
					joined.set(carry);
					joined.set(bytes, carry.length);
					bytes = joined;
					carry = null;
				}
				const usable = bytes.length - (bytes.length % 2);
				if (usable !== bytes.length) carry = bytes.slice(usable);
				if (!usable) continue;
				const pcm = new Int16Array(bytes.slice(0, usable).buffer);
				const buffer = context.createBuffer(1, pcm.length, sampleRate);
				const channel = buffer.getChannelData(0);
				for (let index = 0; index < pcm.length; index += 1) channel[index] = pcm[index] / 32_768;
				const source = context.createBufferSource();
				source.buffer = buffer;
				source.connect(context.destination);
				const start = Math.max(context.currentTime + 0.03, nextStart);
				source.start(start);
				nextStart = start + buffer.duration;
			}
			if (!signal.aborted) {
				await new Promise((resolve) =>
					setTimeout(resolve, Math.max(0, nextStart - context.currentTime) * 1_000)
				);
			}
		} finally {
			await context.close().catch(() => undefined);
			if (speechContext === context) speechContext = null;
		}
	}

	function queueSpeech(complete: boolean) {
		if (!active) return;
		const next = takeSpeakableText(responseText, spokenOffset, complete);
		if (!next.text) return;
		spokenOffset = next.offset;
		const currentGeneration = generation;
		speechQueue = speechQueue.then(() => playSpeech(next.text, currentGeneration));
	}

	function applyEvents(events: SessionEvent[], activeMessageId: string) {
		if (!active) return;
		let finished = false;
		for (const event of events) {
			if (event.payload.messageId !== activeMessageId) continue;
			if (event.type === 'agent.chunk') {
				responseText += String(event.payload.text ?? '');
				queueSpeech(false);
			}
			if (['message.completed', 'message.failed', 'message.unknown'].includes(event.type)) {
				queueSpeech(true);
				finished = true;
			}
		}
		if (finished) {
			const currentGeneration = generation;
			void speechQueue.finally(() => {
				if (active && !muted && currentGeneration === generation) void beginListening();
			});
		}
	}

	async function start(messageOnlyCapture: boolean) {
		if (active || !options.hasSession()) return;
		generation += 1;
		active = true;
		messageOnly = messageOnlyCapture;
		muted = false;
		error = '';
		responseText = '';
		spokenOffset = 0;
		speechQueue = Promise.resolve();
		await tick();
		if (messageOnlyCapture) cancelElement?.focus();
		else muteElement?.focus();
		await beginListening();
	}

	function toggleMute() {
		if (!active) return;
		muted = !muted;
		stream?.getAudioTracks().forEach((track) => (track.enabled = !muted));
		if (muted) {
			transcribeAbort?.abort();
			stopRecording(true);
		} else if (!options.isBusy()) {
			void beginListening();
		}
	}

	async function interrupt() {
		if (!active) return;
		generation += 1;
		responseText = '';
		spokenOffset = 0;
		speechQueue = Promise.resolve();
		transcribeAbort?.abort();
		stopPlayback();
		if (options.isBusy()) await options.stopTurn();
		if (active && !muted) void beginListening();
		await tick();
		muteElement?.focus();
	}

	function prepareToSend() {
		if (!active) return;
		stopRecording(true);
		responseText = '';
		spokenOffset = 0;
		status = 'thinking';
	}

	function end(restoreFocus = true) {
		const wasMessageOnly = messageOnly;
		generation += 1;
		active = false;
		messageOnly = false;
		muted = false;
		status = 'idle';
		stopRecording(true);
		transcribeAbort?.abort();
		transcribeAbort = null;
		stopPlayback();
		stream?.getTracks().forEach((track) => track.stop());
		stream = null;
		streamPromise = null;
		if (restoreFocus)
			void tick().then(() => (wasMessageOnly ? messageElement : startElement)?.focus());
	}

	return {
		get active() {
			return active;
		},
		get messageOnly() {
			return messageOnly;
		},
		get muted() {
			return muted;
		},
		get status() {
			return status;
		},
		get error() {
			return error;
		},
		get startElement() {
			return startElement;
		},
		set startElement(value: HTMLButtonElement | undefined) {
			startElement = value;
		},
		get messageElement() {
			return messageElement;
		},
		set messageElement(value: HTMLButtonElement | undefined) {
			messageElement = value;
		},
		get muteElement() {
			return muteElement;
		},
		set muteElement(value: HTMLButtonElement | undefined) {
			muteElement = value;
		},
		get cancelElement() {
			return cancelElement;
		},
		set cancelElement(value: HTMLButtonElement | undefined) {
			cancelElement = value;
		},
		startCall: () => start(false),
		startMessage: () => start(true),
		toggleMute,
		interrupt,
		prepareToSend,
		applyEvents,
		end
	};
}
