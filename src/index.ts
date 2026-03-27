import { onAuthStateChanged, signInWithPopup } from "firebase/auth";
import { auth, googleProvider } from "./firebase-config";
import { defAtom } from "@thi.ng/atom";
import { div } from "@thi.ng/hiccup-html";
import { $compile } from "@thi.ng/rdom";
import { fromRAF } from "@thi.ng/rstream";
import { initGraph } from "@thi.ng/rstream-graph";
import { Pane } from "tweakpane";
import { ecs, STATE, REST } from "./memory";
import * as Content from "./html";

// 1. Set up the Auth Listener
onAuthStateChanged(auth, user => {
	if (user) {
		console.log("Authenticated as:", user.displayName);
		removeLoginScreen();
		startApp();
	} else {
		showLoginScreen();
	}
});

// 2. The Login UI
function showLoginScreen() {
	if (document.getElementById("login-container")) return;

	const container = document.createElement("div");
	container.id = "login-container";
	container.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: #111; display: flex; justify-content: center; align-items: center;
    z-index: 9999; color: white; font-family: sans-serif;`;

	const btn = document.createElement("button");
	btn.innerText = "Sign in with Google";
	btn.style.cssText = `
    padding: 12px 24px; font-size: 16px; cursor: pointer;
    background: white; color: black; border: none; border-radius: 4px;`;

	btn.onclick = () => {
		signInWithPopup(auth, googleProvider).catch(error => {
			console.error("Login failed:", error);
		});
	};

	container.appendChild(btn);
	document.body.appendChild(container);
}

function removeLoginScreen() {
	const container = document.getElementById("login-container");
	if (container) container.remove();
}

async function startApp() {
	console.log("Running Raw WebGL2 Compute Engine...");

	// ==========================================
	// 1. THE KNOBS (Tweakpane GUI State)
	// ==========================================
	const PARAMS = {
		decay: 0.08,
		violence: 450.0,
		physicalLimit: 60.0,
		stormRadius: 0.45,
		noiseScale: 3.5,
		noiseSpeed: 0.8,
	};

	const pane = new Pane({ title: "Phenomenology Controls" });
	pane.addBinding(PARAMS, "decay", { min: 0.01, max: 0.5, step: 0.01 });
	pane.addBinding(PARAMS, "violence", { min: 50, max: 1000, label: "Urge Violence" });
	pane.addBinding(PARAMS, "physicalLimit", { min: 60, max: 140, label: "Straight Jacket" });
	pane.addBinding(PARAMS, "stormRadius", { min: 0.1, max: 1.5 });
	pane.addBinding(PARAMS, "noiseScale", { min: 1.0, max: 15.0 });
	pane.addBinding(PARAMS, "noiseSpeed", { min: 0.1, max: 3.0 });

	// PERFECT DEFAULTS
	const CONFIG = {
		restWght: 300.0,
		restWdth: 100.0,
		restItal: 0.0,
		restCont: 0.0,
	};

	const tsUI = document.createElement("div");
	tsUI.id = "troubleshooting-ui";
	tsUI.innerText = "Booting Compute Engine...";
	document.body.appendChild(tsUI);

	const vw = window.innerWidth;
	const vh = window.innerHeight;

	// GLOBAL MOUSE TRACKING FIX
	let mouseClientX = vw / 2;
	let mouseClientY = vh / 2;
	window.addEventListener("mousemove", e => {
		mouseClientX = e.clientX;
		mouseClientY = e.clientY;
	});

	let WORD_COUNT: number = 0;

	const sortedPages = Object.keys(Content)
		.filter(key => key.startsWith("page"))
		.sort((a, b) => parseInt(a.replace("page", "")) - parseInt(b.replace("page", "")))
		.map((key, idx) => {
			const pageArr = [...(Content[key as keyof typeof Content] as any[])];
			pageArr[1] = Object.assign({}, pageArr[1], { "data-page-index": idx });
			return pageArr;
		});

	const book = div({ id: "pages" }, ...sortedPages);

	const canvas = new OffscreenCanvas(64, 64);
	const gl = canvas.getContext("webgl2")!;

	if (!gl) throw new Error("WebGL2 not supported!");
	if (!gl.getExtension("EXT_color_buffer_float")) {
		console.error("EXT_color_buffer_float not supported! Falling back to WebGL 2 defaults.");
	}

	//@ts-ignore
	await document.fonts.ready;
	$compile(book).mount(document.getElementById("app")!);

	const domNodes = Array.from(document.getElementsByClassName("word"));
	WORD_COUNT = domNodes.length;
	ecs.setCapacity(WORD_COUNT);

	const rootFontSize = parseFloat(window.getComputedStyle(document.documentElement).fontSize);
	const wordsByPage: Record<number, number[]> = {};

	for (let i = 0; i < WORD_COUNT; i++) {
		const el = domNodes[i] as HTMLElement;
		const rect = el.getBoundingClientRect();

		el.style.width = rect.width / rootFontSize + "rem";
		el.style.height = rect.height / rootFontSize + "rem";
		el.classList.add("frozen");

		// GLOBAL COORDINATE FIX
		const x = rect.left + rect.width * 0.5;
		const y = rect.top + window.scrollY + rect.height * 0.5; // Absolute document position
		const norm_x = x / vw;
		const norm_y = y / vh;

		const parentPage = el.closest(".page");
		const pIndex = parentPage ? parseInt(parentPage.getAttribute("data-page-index")!) : 0;

		if (!wordsByPage[pIndex]) wordsByPage[pIndex] = [];
		wordsByPage[pIndex].push(i);

		const entity = ecs.defEntity([STATE, REST]);
		STATE.set(entity, [CONFIG.restWght, CONFIG.restWdth, CONFIG.restItal, CONFIG.restCont]);
		REST.set(entity, [norm_x, norm_y]);
	}

	let activePageIndex = 0;
	const observer = new IntersectionObserver(
		entries => {
			entries.forEach(entry => {
				if (entry.isIntersecting) {
					activePageIndex = parseInt(entry.target.getAttribute("data-page-index")!, 10);
				}
			});
		},
		{ root: document.getElementById("app"), threshold: 0.5 },
	);
	document.querySelectorAll(".page").forEach(sec => observer.observe(sec));

	// ==========================================
	// THE RAW COMPUTE SHADER (Bypassing AST entirely)
	// ==========================================

	const vsSource = `#version 300 es
		in vec4 a_particleData; // [wght, wdth, ital, urge]
		in vec2 a_position;     // [x, y]
		out vec4 v_newParticleData;

		uniform float u_time;
		uniform vec2 u_mouse;
		uniform float u_decay;
		uniform float u_violence;
		uniform float u_physicalLimit;
		uniform float u_stormRadius;
		uniform float u_noiseScale;
		uniform float u_noiseSpeed;
		uniform vec4 u_restState;

		vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
		vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
		vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
		vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

		float snoise(vec3 v) {
			const vec2 C = vec2(1.0/6.0, 1.0/3.0);
			const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
			vec3 i  = floor(v + dot(v, C.yyy));
			vec3 x0 = v - i + dot(i, C.xxx);
			vec3 g = step(x0.yzx, x0.xyz);
			vec3 l = 1.0 - g;
			vec3 i1 = min(g.xyz, l.zxy);
			vec3 i2 = max(g.xyz, l.zxy);
			vec3 x1 = x0 - i1 + C.xxx;
			vec3 x2 = x0 - i2 + C.yyy;
			vec3 x3 = x0 - D.yyy;
			i = mod289(i);
			vec4 p = permute(permute(permute(
						i.z + vec4(0.0, i1.z, i2.z, 1.0))
					+ i.y + vec4(0.0, i1.y, i2.y, 1.0))
					+ i.x + vec4(0.0, i1.x, i2.x, 1.0));
			float n_ = 0.142857142857;
			vec3  ns = n_ * D.wyz - D.xzx;
			vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
			vec4 x_ = floor(j * ns.z);
			vec4 y_ = floor(j - 7.0 * x_);
			vec4 x = x_ *ns.x + ns.yyyy;
			vec4 y = y_ *ns.x + ns.yyyy;
			vec4 h = 1.0 - abs(x) - abs(y);
			vec4 b0 = vec4(x.xy, y.xy);
			vec4 b1 = vec4(x.zw, y.zw);
			vec4 s0 = floor(b0)*2.0 + 1.0;
			vec4 s1 = floor(b1)*2.0 + 1.0;
			vec4 sh = -step(h, vec4(0.0));
			vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
			vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
			vec3 p0 = vec3(a0.xy, h.x);
			vec3 p1 = vec3(a0.zw, h.y);
			vec3 p2 = vec3(a1.xy, h.z);
			vec3 p3 = vec3(a1.zw, h.w);
			vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
			p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
			vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
			m = m * m;
			return 105.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
		}

		float fbm(vec3 x) {
			float v = 0.0;
			float a = 0.5;
			vec3 shift = vec3(100.0);
			for (int i = 0; i < 3; ++i) {
				v += a * snoise(x);
				x = x * 2.0 + shift;
				a *= 0.5;
			}
			return v;
		}

		void main() {
			vec4 current = a_particleData;

			// 1. SDF Mask (Absolute Global Document Hover)
			float dist = distance(a_position, u_mouse);
			float baseMask = 1.0 - smoothstep(0.0, u_stormRadius, dist);
			float stormMask = pow(baseMask, 4.0);

			// 2. The Storm Field
			vec3 noiseCoords = vec3(a_position * u_noiseScale, u_time * u_noiseSpeed);
			float turbulence = fbm(noiseCoords); 

			// 3. Accumulate "Urge" in the W-channel
			current.w += stormMask * 1.5;
			current.w = mix(current.w, 0.0, 0.01); // Fast dissipation

			float explosiveForce = 0.0;
			float isSnapping = 0.0;

			// 4. THRESHOLD BREAK & EXHAUSTION
			if (current.w > 35.0) {
				explosiveForce = turbulence * current.w;
				
				// THE REFRACTORY PERIOD: Drop to negatives
				current.w = -200.0; 
				isSnapping = 1.0;
			}

			// A. WGHT (Swelling: 47 to 900)
			float wghtTarget = u_restState.x + (max(current.w, 0.0) * 6.0) + (abs(explosiveForce) * u_violence);
			if (isSnapping > 0.5) {
				current.x = wghtTarget; // Instant visual impact
			}
			current.x = mix(current.x, wghtTarget, 0.15); 
			current.x = clamp(current.x, 47.0, 900.0);

			// B. WDTH (Volume & Compression: 60 to 140)
			float wdthTarget = u_restState.y;
			if (isSnapping > 0.5) {
				float crushForce = clamp(abs(explosiveForce) * (u_violence * 0.05), 0.0, 140.0 - u_physicalLimit);
				wdthTarget = clamp(u_restState.y - crushForce, u_physicalLimit, 140.0);
				current.y = wdthTarget; // Instant crush
			}
			current.y = mix(current.y, wdthTarget, 0.2);
			current.y = clamp(current.y, 60.0, 140.0);

			// C. ITAL (Shear Velocity: 0 to 12)
			float italTarget = u_restState.z;
			if (isSnapping > 0.5) {
				italTarget = clamp(abs(explosiveForce) * 0.2, 0.0, 12.0);
				current.z = italTarget; // Instant shear
			}
			current.z = mix(current.z, italTarget, 0.2);
			current.z = clamp(current.z, 0.0, 12.0);

			// 5. DECAY
			// Skip decay logic on the exact frame it snaps so the impact lands at 100% force
			if (isSnapping < 0.5) {
				current.x = mix(current.x, u_restState.x, u_decay);
				current.y = mix(current.y, u_restState.y, u_decay);
				current.z = mix(current.z, u_restState.z, u_decay);
			}

			v_newParticleData = current;
		}
	`;

	const fsSource = `#version 300 es
					precision mediump float; out vec4 fragColor; void main() { fragColor = vec4(0.0); }
				`;

	function compileShader(type: any, source: any) {
		const shader: WebGLShader = gl.createShader(type)!;
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		return shader;
	}
	const glProgram = gl.createProgram()!;
	gl.attachShader(glProgram, compileShader(gl.VERTEX_SHADER, vsSource));
	gl.attachShader(glProgram, compileShader(gl.FRAGMENT_SHADER, fsSource));
	gl.transformFeedbackVaryings(glProgram, ["v_newParticleData"], gl.SEPARATE_ATTRIBS);
	gl.linkProgram(glProgram);

	const locs = {
		time: gl.getUniformLocation(glProgram, "u_time"),
		mouse: gl.getUniformLocation(glProgram, "u_mouse"),
		decay: gl.getUniformLocation(glProgram, "u_decay"),
		violence: gl.getUniformLocation(glProgram, "u_violence"),
		physicalLimit: gl.getUniformLocation(glProgram, "u_physicalLimit"),
		stormRadius: gl.getUniformLocation(glProgram, "u_stormRadius"),
		noiseScale: gl.getUniformLocation(glProgram, "u_noiseScale"),
		noiseSpeed: gl.getUniformLocation(glProgram, "u_noiseSpeed"),
		restState: gl.getUniformLocation(glProgram, "u_restState"),
	};

	const bufferA = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, bufferA);
	gl.bufferData(gl.ARRAY_BUFFER, STATE.vals, gl.DYNAMIC_COPY);
	const bufferB = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, bufferB);
	gl.bufferData(gl.ARRAY_BUFFER, STATE.vals.byteLength, gl.DYNAMIC_COPY);
	const pingPongBuffers = [bufferA, bufferB];

	const restBUFFER = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, restBUFFER);
	gl.bufferData(gl.ARRAY_BUFFER, REST.vals, gl.STATIC_DRAW);

	const dataLocation = gl.getAttribLocation(glProgram, "a_particleData");
	const posLocation = gl.getAttribLocation(glProgram, "a_position");

	const vaoA = gl.createVertexArray();
	gl.bindVertexArray(vaoA);
	gl.bindBuffer(gl.ARRAY_BUFFER, bufferA);
	gl.enableVertexAttribArray(dataLocation);
	gl.vertexAttribPointer(dataLocation, 4, gl.FLOAT, false, 0, 0);
	gl.bindBuffer(gl.ARRAY_BUFFER, restBUFFER);
	gl.enableVertexAttribArray(posLocation);
	gl.vertexAttribPointer(posLocation, 2, gl.FLOAT, false, 0, 0);

	const vaoB = gl.createVertexArray();
	gl.bindVertexArray(vaoB);
	gl.bindBuffer(gl.ARRAY_BUFFER, bufferB);
	gl.enableVertexAttribArray(dataLocation);
	gl.vertexAttribPointer(dataLocation, 4, gl.FLOAT, false, 0, 0);
	gl.bindBuffer(gl.ARRAY_BUFFER, restBUFFER);
	gl.enableVertexAttribArray(posLocation);
	gl.vertexAttribPointer(posLocation, 2, gl.FLOAT, false, 0, 0);

	gl.bindVertexArray(null);
	gl.bindBuffer(gl.ARRAY_BUFFER, null);

	const pbo = gl.createBuffer();
	gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
	gl.bufferData(gl.PIXEL_PACK_BUFFER, STATE.vals.byteLength, gl.STREAM_READ);
	gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);

	let readIndex = 0;
	let currentFence = null!;
	const previousState = new Float32Array(WORD_COUNT * 4);
	let lastTime = performance.now();
	let frameCount = 0;

	const raf$ = fromRAF({ timestamp: true });
	const db = defAtom({});

	if (!tsUI.firstChild) tsUI.appendChild(document.createTextNode(""));
	const fpsTextNode = tsUI.firstChild!;

	initGraph(db, {
		gpuNode: {
			fn: inputs =>
				inputs.raf.map(now => {
					const currentTime = performance.now();
					frameCount++;
					if (currentTime >= lastTime + 1000) {
						fpsTextNode.nodeValue = `COMPUTE FPS: ${frameCount} | WORDS: ${WORD_COUNT}`;
						frameCount = 0;
						lastTime = currentTime;
					}

					let emittedData = null;

					if (currentFence) {
						const status = gl.clientWaitSync(currentFence, 0, 0);
						if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
							gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
							gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, STATE.vals);
							gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
							gl.deleteSync(currentFence);
							currentFence = null!;
							emittedData = STATE.vals;
						} else {
							return null;
						}
					}

					if (!currentFence) {
						const writeIndex = 1 - readIndex;
						const outputBuffer = pingPongBuffers[writeIndex];
						const activeVAO = readIndex === 0 ? vaoA : vaoB;

						gl.useProgram(glProgram);

						// DYNAMIC MOUSE COORDINATE MATCHING
						const globalMouseX = mouseClientX / vw;
						const globalMouseY = (mouseClientY + window.scrollY) / vh;

						gl.uniform1f(locs.time, now * 0.001);
						gl.uniform2f(locs.mouse, globalMouseX, globalMouseY);
						gl.uniform1f(locs.decay, PARAMS.decay);
						gl.uniform1f(locs.violence, PARAMS.violence);
						gl.uniform1f(locs.physicalLimit, PARAMS.physicalLimit);
						gl.uniform1f(locs.stormRadius, PARAMS.stormRadius);
						gl.uniform1f(locs.noiseScale, PARAMS.noiseScale);
						gl.uniform1f(locs.noiseSpeed, PARAMS.noiseSpeed);

						gl.uniform4f(
							locs.restState,
							CONFIG.restWght,
							CONFIG.restWdth,
							CONFIG.restItal,
							CONFIG.restCont,
						);

						gl.bindVertexArray(activeVAO);
						gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, outputBuffer);

						gl.enable(gl.RASTERIZER_DISCARD);
						gl.beginTransformFeedback(gl.POINTS);
						gl.drawArrays(gl.POINTS, 0, WORD_COUNT);
						gl.endTransformFeedback();
						gl.disable(gl.RASTERIZER_DISCARD);

						gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
						gl.bindVertexArray(null);

						gl.bindBuffer(gl.COPY_READ_BUFFER, outputBuffer);
						gl.bindBuffer(gl.COPY_WRITE_BUFFER, pbo);
						gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, STATE.vals.byteLength);
						gl.bindBuffer(gl.COPY_READ_BUFFER, null);
						gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);

						// @ts-ignore
						currentFence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
						gl.flush();
						readIndex = writeIndex;
					}
					return emittedData;
				}),
			ins: { raf: { stream: () => raf$ } },
		},

		uiNode: {
			fn: inputs =>
				inputs.gpu.subscribe({
					next: ecsData => {
						if (!ecsData) return;
						const activeIndices = wordsByPage[activePageIndex] || [];

						for (let j = 0; j < activeIndices.length; j++) {
							const i = activeIndices[j];
							const idx = i * 4;
							const el = domNodes[i] as HTMLElement;

							let wght = Math.round(ecsData[idx]);
							let wdth = Math.round(ecsData[idx + 1]);
							let ital = Number(ecsData[idx + 2].toFixed(2));

							if (Math.abs(wght - CONFIG.restWght) < 5) wght = CONFIG.restWght;
							if (Math.abs(wdth - CONFIG.restWdth) < 2) wdth = CONFIG.restWdth;
							if (Math.abs(ital - CONFIG.restItal) < 0.2) ital = CONFIG.restItal;

							if (wght !== previousState[idx]) {
								el.style.setProperty("--wght", `${wght}`);
								previousState[idx] = wght;
							}
							if (wdth !== previousState[idx + 1]) {
								el.style.setProperty("--wdth", `${wdth}`);
								previousState[idx + 1] = wdth;
							}
							if (ital !== previousState[idx + 2]) {
								el.style.setProperty("--ital", `${ital}`);
								previousState[idx + 2] = ital;
							}
						}
					},
				}),
			ins: { gpu: { stream: "/gpuNode/node" } },
		},
	});
}
