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
		// User is signed in!
		console.log("Authenticated as:", user.displayName);
		removeLoginScreen();
		startApp();
	} else {
		// User is signed out.
		showLoginScreen();
	}
});

// 2. The Login UI
function showLoginScreen() {
	// Check if it already exists to prevent duplicates
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
	console.log("Running thi.ng code...");

	// ==========================================
	// 1. THE KNOBS (Tweakpane GUI State)
	// ==========================================
	const PARAMS = {
		decay: 0.08, // How fast fonts snap back
		force: 350.0, // Max weight added per frame by the storm
		stormRadius: 0.35, // Size of the SDF around the mouse
		noiseScale: 4.0, // How "wide" the FBM waves are
		noiseSpeed: 0.5, // How fast the storm boils
	};

	const pane = new Pane({ title: "Storm Controls" });
	pane.addBinding(PARAMS, "decay", {
		min: 0.01,
		max: 0.5,
		step: 0.01,
	});
	pane.addBinding(PARAMS, "force", { min: 50, max: 800 });
	pane.addBinding(PARAMS, "stormRadius", { min: 0.1, max: 1.5 });
	pane.addBinding(PARAMS, "noiseScale", { min: 1.0, max: 15.0 });
	pane.addBinding(PARAMS, "noiseSpeed", { min: 0.1, max: 2.0 });

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

	// Track mouse globally for the SDF
	let mouseX = 0.5;
	let mouseY = 0.5;
	window.addEventListener("mousemove", e => {
		mouseX = e.clientX / vw;
		mouseY = 1.0 - e.clientY / vh; // Invert Y for WebGL math
	});

	let WORD_COUNT: number = 0;

	/********************
	 * DOM SETUP
	 *********************/
	const sortedPages = Object.keys(Content)
		.filter(key => key.startsWith("page"))
		.sort((a, b) => parseInt(a.replace("page", "")) - parseInt(b.replace("page", "")))
		.map(key => Content[key as keyof typeof Content]);

	// ---> REMOVE THIS LOOP? <---
	// This dynamically adds {"data-page-index": 0, ...} to each section's attributes
	sortedPages.forEach((page: any, idx) => {
		if (page[1]) {
			page[1]["data-page-index"] = idx;
		}
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

	/********************
	 * DOM MOUNTED!
	 *********************/
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

		const x = rect.left + rect.width * 0.5;
		const y = rect.top + rect.height * 0.5;
		const norm_x = x / vw;
		const norm_y = 1.0 - (y % vh) / vh;

		const parentPage = el.closest(".page");
		const pIndex = parentPage ? parseInt(parentPage.getAttribute("data-page-index")!) : 0;

		if (!wordsByPage[pIndex]) wordsByPage[pIndex] = [];
		wordsByPage[pIndex].push(i);

		const entity = ecs.defEntity([STATE, REST]);
		STATE.set(entity, [CONFIG.restWght, CONFIG.restWdth, CONFIG.restItal, CONFIG.restCont]);

		REST.set(entity, [norm_x, norm_y]);
		// PAGE.set(entity, [pIndex]);
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
	// THE COMPUTE SHADER (FBM + SDF)
	// ==========================================
	const vsSource = `#version 300 es
					in vec4 a_particleData; // [wght, wdth, ital, seed]
					in vec2 a_position;     // [x, y] spatial location on screen
					out vec4 v_newParticleData;

					// Our Knobs!
					uniform float u_time;
					uniform vec2 u_mouse;
					uniform float u_decay;
					uniform float u_force;
					uniform float u_stormRadius;
					uniform float u_noiseScale;
					uniform float u_noiseSpeed;

					// Ashima Arts 3D Simplex Noise
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

					// Fractal Brownian Motion
					float fbm(vec3 x) {
						float v = 0.0;
						float a = 0.5;
						vec3 shift = vec3(100.0);
						for (int i = 0; i < 3; ++i) { // 3 Octaves for performance
							v += a * snoise(x);
							x = x * 2.0 + shift;
							a *= 0.5;
						}
						return v;
					}

					void main() {
						vec4 current = a_particleData;
						vec4 restState = vec4(float(${CONFIG.restWght}), float(${CONFIG.restWdth}), float(${CONFIG.restItal}), 0.0);

						// 1. Geography (The SDF Mask)
						// Distance from this word to the mouse cursor
						float dist = distance(a_position, u_mouse);
						// Smooth radial mask: 1.0 at center, fading to 0.0 at the storm radius
						float baseMask = 1.0 - smoothstep(0.0, u_stormRadius, dist);
						float stormMask = pow(baseMask, 4.0);

						// 2. Weather (The Flow Field)
						// Calculate turbulence based on X/Y position and flowing Time
						vec3 noiseCoords = vec3(a_position * u_noiseScale, u_time * u_noiseSpeed);
						float turbulence = fbm(noiseCoords); // Returns approx -1.0 to 1.0

						// 3. Physics (The Urge-Release Cycle)
						// Build tension based on the mask, but slowly leak tension over time (dissipation)
						// This ensures tics fade if you move the mouse away before they snap.
						current.w += stormMask * 0.8;
						current.w = mix(current.w, 0.0, 0.02);

						float explosiveForce = 0.0;

						// THRESHOLD: Has the internal pressure reached the breaking point?
						if (current.w > 35.0) {
							// The violent snap!
							explosiveForce = turbulence * current.w;

							// RELEASE: The tic happened. Reset the biological pressure back to zero.
							current.w = 0.0;
						}

						// APPLY FORCE: absolute value ensures it only ever gets heavier, never lighter than 400
						current.x += abs(explosiveForce) * u_force;

						// Cap the maximum weight so the font doesn't mathematically break the layout
						current.x = min(current.x, 900.0);

						// 4. Friction & Gravity (The Decay) - CRITICAL FOR RETURNING TO REST
						// Zeno's Paradox exponential decay pulling it back to the Rest State.
						current.x = mix(current.x, restState.x, u_decay);

						// Ensure the random seed channel stays intact if you use it for noise offsets later
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
	const program = gl.createProgram()!;
	gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vsSource));
	gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fsSource));
	gl.transformFeedbackVaryings(program, ["v_newParticleData"], gl.SEPARATE_ATTRIBS);
	gl.linkProgram(program);

	// Bind Uniforms
	const locs = {
		time: gl.getUniformLocation(program, "u_time"),
		mouse: gl.getUniformLocation(program, "u_mouse"),
		decay: gl.getUniformLocation(program, "u_decay"),
		force: gl.getUniformLocation(program, "u_force"),
		stormRadius: gl.getUniformLocation(program, "u_stormRadius"),
		noiseScale: gl.getUniformLocation(program, "u_noiseScale"),
		noiseSpeed: gl.getUniformLocation(program, "u_noiseSpeed"),
	};

	// Setup Buffers
	const bufferA = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, bufferA);
	gl.bufferData(gl.ARRAY_BUFFER, STATE.vals, gl.DYNAMIC_COPY);
	const bufferB = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, bufferB);
	gl.bufferData(gl.ARRAY_BUFFER, STATE.vals.byteLength, gl.DYNAMIC_COPY);
	const pingPongBuffers = [bufferA, bufferB];

	// NEW: Setup Spatial Buffer!
	const restBUFFER = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, restBUFFER);
	gl.bufferData(gl.ARRAY_BUFFER, REST.vals, gl.STATIC_DRAW);

	const dataLocation = gl.getAttribLocation(program, "a_particleData");
	const posLocation = gl.getAttribLocation(program, "a_position");

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

						gl.useProgram(program);

						// Push the Knobs to the GPU!
						gl.uniform1f(locs.time, now * 0.001);
						gl.uniform2f(locs.mouse, mouseX, mouseY);
						gl.uniform1f(locs.decay, PARAMS.decay);
						gl.uniform1f(locs.force, PARAMS.force);
						gl.uniform1f(locs.stormRadius, PARAMS.stormRadius);
						gl.uniform1f(locs.noiseScale, PARAMS.noiseScale);
						gl.uniform1f(locs.noiseSpeed, PARAMS.noiseSpeed);

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
							let ital = Math.round(ecsData[idx + 2]);

							// THE GOLDEN RATIO FIX: CPU Snap-to-Rest
							// Completely kills the invisible "tail" of exponential decay
							if (Math.abs(wght - CONFIG.restWght) < 5) wght = CONFIG.restWght;
							if (Math.abs(wdth - CONFIG.restWdth) < 5) wdth = CONFIG.restWdth;
							if (Math.abs(ital - CONFIG.restItal) < 1) ital = CONFIG.restItal;

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
