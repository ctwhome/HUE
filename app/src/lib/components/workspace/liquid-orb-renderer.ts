/* Substantially adapted from LerSent001/orb. See THIRD_PARTY_NOTICES.md. */

type FrameLoop = { start: () => void; stop: () => void };
const UNIFORM_COPY_DST_USAGE = 0x40 | 0x08;

export function createFrameLoop(
	render: FrameRequestCallback,
	requestFrame: (callback: FrameRequestCallback) => number = requestAnimationFrame,
	cancelFrame: (id: number) => void = cancelAnimationFrame,
	onError: () => void = () => {}
): FrameLoop {
	let frame = 0;
	let running = false;
	const tick: FrameRequestCallback = (now) => {
		if (!running) return;
		try {
			render(now);
		} catch {
			running = false;
			cancelFrame(frame);
			onError();
		}
		if (running) frame = requestFrame(tick);
	};
	return {
		start() {
			if (running) return;
			running = true;
			frame = requestFrame(tick);
		},
		stop() {
			if (!running) return;
			running = false;
			cancelFrame(frame);
		}
	};
}

export function resizeCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
	if (canvas.width !== width) canvas.width = width;
	if (canvas.height !== height) canvas.height = height;
}

const shader = /* wgsl */ `
struct Uniforms { size: vec2<f32>, time: f32, pad: f32 }
@group(0) @binding(0) var<uniform> u: Uniforms;
struct VOut { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> VOut {
  var points = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0)
  );
  var out: VOut;
  out.position = vec4<f32>(points[i], 0.0, 1.0);
  out.uv = (points[i] + 1.0) * 0.5;
  return out;
}

fn band(q: vec2<f32>, t: f32, phase: f32, amplitude: f32, softness: f32) -> f32 {
  let envelopeBase = cos(1.57079633 * min(abs(q.x * 0.9), 1.0));
  let envelope = envelopeBase * envelopeBase;
  let mainY = amplitude * envelope * sin(q.x * 1.1 + t * 2.15);
  let y = (amplitude + 0.035) * envelope * sin(q.x + t * 2.15 + phase);
  let distanceToLine = abs(q.y - y);
  let line = exp(-(distanceToLine * distanceToLine) / softness);
  let enclosed = exp(-abs(q.y - mix(mainY, y, 0.5)) * 6.5);
  return (line + enclosed * 0.24) * envelope;
}

@fragment fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let aspect = u.size.x / max(u.size.y, 1.0);
  var p = (in.uv * 2.0 - 1.0) * vec2<f32>(aspect, 1.0);
  p.y = -p.y;
  let radius = 0.72 + sin(atan2(p.y, p.x) * 3.0 + u.time * 0.38) * 0.012;
  let distance = length(p);
  let alpha = 1.0 - smoothstep(radius - 0.025, radius + 0.018, distance);
  if (alpha <= 0.0) { discard; }

  let q = p / radius;
  let t = u.time * 0.72;
  let pink = vec3<f32>(1.0, 0.42, 0.78);
  let cyan = vec3<f32>(0.35, 0.92, 1.0);
  let violet = vec3<f32>(0.49, 0.35, 0.95);
  let gold = vec3<f32>(1.0, 0.78, 0.38);
  let deep = vec3<f32>(0.035, 0.026, 0.065);
  let b0 = band(q, t, -1.85, 0.25, 0.012);
  let b1 = band(q, t, -0.62, 0.25, 0.010);
  let b2 = band(q, t, 0.62, 0.25, 0.010);
  let b3 = band(q, t, 1.85, 0.25, 0.012);
  let energy = b0 + b1 + b2 + b3;
  var color = deep + (pink * b0 + cyan * b1 + violet * b2 + gold * b3) * 0.62;
  let envelopeBase = cos(1.57079633 * min(abs(q.x * 0.9), 1.0));
  let envelope = envelopeBase * envelopeBase;
  let mainY = 0.25 * envelope * sin(q.x * 1.1 + t * 2.15);
  let whiteCore = exp(-pow(abs(q.y - mainY), 2.0) / 0.0032) * envelope;
  color += vec3<f32>(1.0, 0.92, 1.0) * whiteCore * 0.72;
  color = color / (vec3<f32>(1.0) + color * (0.12 + energy * 0.04));

  let z = sqrt(max(radius * radius - distance * distance, 0.0)) / radius;
  let fresnel = pow(1.0 - z, 3.0);
  let normal = normalize(vec3<f32>(p, z));
  let light = normalize(vec3<f32>(-0.5, 0.7, 0.8));
  let key = pow(max(dot(normal, light), 0.0), 22.0);
  color = color * (0.7 + z * 0.36) + vec3<f32>(0.72, 0.66, 1.0) * fresnel * 0.42;
  color += vec3<f32>(1.0) * key * 0.72;
  return vec4<f32>(color, alpha);
}`;

export function mountLiquidOrb(
	canvas: HTMLCanvasElement,
	context: GPUCanvasContext,
	callbacks: { onReady: () => void; onError: () => void }
): () => void {
	let disposed = false;
	let failed = false;
	let device: GPUDevice;
	let loop: FrameLoop | undefined;
	let removeDeviceError: (() => void) | undefined;
	const fail = () => {
		if (disposed || failed) return;
		failed = true;
		loop?.stop();
		removeDeviceError?.();
		device?.destroy();
		callbacks.onError();
	};

	void (async () => {
		try {
			const gpu = navigator.gpu;
			const adapter = await gpu.requestAdapter();
			if (!adapter) throw new Error('WebGPU adapter unavailable');
			device = await adapter.requestDevice();
			if (disposed) return device.destroy();
			const format = gpu.getPreferredCanvasFormat();
			context.configure({ device, format, alphaMode: 'premultiplied' });
			const module = device.createShaderModule({ label: 'hue-liquid-thinking-orb', code: shader });
			const compilation = await module.getCompilationInfo();
			if (compilation.messages.some((message) => message.type === 'error')) {
				throw new Error('Liquid orb shader compilation failed');
			}
			const pipeline = device.createRenderPipeline({
				layout: 'auto',
				vertex: { module, entryPoint: 'vs_main' },
				fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
				primitive: { topology: 'triangle-list' }
			});
			const values = new Float32Array(4);
			const buffer = device.createBuffer({
				size: values.byteLength,
				usage: UNIFORM_COPY_DST_USAGE
			});
			const bindGroup = device.createBindGroup({
				layout: pipeline.getBindGroupLayout(0),
				entries: [{ binding: 0, resource: { buffer } }]
			});
			const started = performance.now();
			const onDeviceError = (event: Event) => {
				event.preventDefault();
				fail();
			};
			device.addEventListener('uncapturederror', onDeviceError);
			removeDeviceError = () => device.removeEventListener('uncapturederror', onDeviceError);
			device.lost.then(() => fail());

			let ready = false;
			loop = createFrameLoop(
				(now) => {
					const dpr = Math.min(devicePixelRatio || 1, 2);
					resizeCanvas(
						canvas,
						Math.max(1, Math.round(canvas.clientWidth * dpr)),
						Math.max(1, Math.round(canvas.clientHeight * dpr))
					);
					values.set([canvas.width, canvas.height, (now - started) / 1000, 0]);
					device.queue.writeBuffer(buffer, 0, values);
					const encoder = device.createCommandEncoder();
					const pass = encoder.beginRenderPass({
						colorAttachments: [
							{
								view: context.getCurrentTexture().createView(),
								clearValue: { r: 0, g: 0, b: 0, a: 0 },
								loadOp: 'clear',
								storeOp: 'store'
							}
						]
					});
					pass.setPipeline(pipeline);
					pass.setBindGroup(0, bindGroup);
					pass.draw(3);
					pass.end();
					device.queue.submit([encoder.finish()]);
					if (!ready) {
						ready = true;
						callbacks.onReady();
					}
				},
				requestAnimationFrame,
				cancelAnimationFrame,
				fail
			);
			loop.start();
		} catch {
			fail();
		}
	})();

	return () => {
		disposed = true;
		loop?.stop();
		removeDeviceError?.();
		device?.destroy();
	};
}
