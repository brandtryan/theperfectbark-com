import { onAuthStateChanged, signInWithPopup } from "firebase/auth";
import { auth, googleProvider } from "./firebase-config";
import { defAtom } from "@thi.ng/atom";
import { div } from "@thi.ng/hiccup-html";
import { $compile } from "@thi.ng/rdom";
import { fromRAF } from "@thi.ng/rstream";
import { initGraph } from "@thi.ng/rstream-graph";
import { STATE, REST, ecs } from "./memory";
import * as Content from "./html";
import { Pane } from "tweakpane";
import {
	assign,
	defMain,
	float,
	vec2,
	vec3,
	vec4,
	sym,
	mul,
	add,
	sub,
	div as sdiv,
	abs,
	clamp,
	dot,
	fract,
	length,
	max,
	mix,
	normalize,
	pow,
	sin,
	cos,
	smoothstep,
	and,
	program,
	defn,
	ret,
	ifThen,
	input,
	output,
	uniform,
	gt,
	lt,
	neg,
	// $,
	$x,
	$y,
	$z,
	$w,
	$xy,
} from "@thi.ng/shader-ast";
import { GLSLVersion, targetGLSL } from "@thi.ng/shader-ast-glsl";
import { snoise3 } from "@thi.ng/shader-ast-stdlib";

async function main() {
	console.log("Running Newtonian GPGPU Engine...");

	const PARAMS = {
		friction: 0.85,
		stiffness: 120.0,
		violence: 12.0,
		physicalLimit: 60.0,
		stormRadius: 0.85,
		noiseScale: 3.5,
		noiseSpeed: 0.8,
		hurst: 0.25,
		flowStrength: 2500.0,
		flowScale: 2.0,
		circleX: 0.5,
		circleY: 0.5,
		circleRadius: 0.15,
		repelStrength: 2000.0,
		willpower: 0.25,
		urgeRate: 150.0,
		urgeDecay: 0.01,
		snapThreshold: 25.0,
		globalWindSpeed: 0.8,
		struggleChance: 0.15,
		sensitivityScale: 3.5,
		sensitivitySpeed: 0.25,
		sensitivityThreshold: 0.2,
		lineSqueeze: 20.0,
		activeWordLimit: 0.55,
		useGhostReader: true,
	};

	const pane = new Pane({ title: "Phenomenology Controls" });
	pane.addBinding(PARAMS, "friction", { min: 0.5, max: 0.99, step: 0.01 });
	pane.addBinding(PARAMS, "stiffness", { min: 10, max: 300, step: 1 });
	pane.addBinding(PARAMS, "violence", { min: 1.0, max: 50.0 });
	pane.addBinding(PARAMS, "physicalLimit", { min: 60, max: 140, label: "Straight Jacket" });
	pane.addBinding(PARAMS, "noiseScale", { min: 1.0, max: 15.0 });
	pane.addBinding(PARAMS, "noiseSpeed", { min: 0.1, max: 3.0 });
	pane.addBinding(PARAMS, "hurst", { min: 0.01, max: 0.99, label: "Roughness (H)" });
	pane.addBinding(PARAMS, "flowStrength", { min: 0, max: 5000, step: 10 });
	pane.addBinding(PARAMS, "flowScale", { min: 0.1, max: 10.0 });
	pane.addBinding(PARAMS, "globalWindSpeed", { min: 0, max: 2.0, label: "Global Wind" });

	const urgeFolder = pane.addFolder({ title: "Neurological Storm (Urge)" });
	urgeFolder.addBinding(PARAMS, "willpower", { min: 0, max: 1.0, label: "Willpower (Resistance)" });
	urgeFolder.addBinding(PARAMS, "urgeRate", { min: 0, max: 200, label: "Irritation Rate" });
	urgeFolder.addBinding(PARAMS, "urgeDecay", { min: 0.001, max: 0.1, label: "Urge Decay" });
	urgeFolder.addBinding(PARAMS, "snapThreshold", { min: 10, max: 100, label: "Snap Threshold" });
	urgeFolder.addBinding(PARAMS, "struggleChance", { min: 0, max: 0.5, step: 0.01, label: "Struggle Chance" });

	const sensFolder = pane.addFolder({ title: "Neurological Sensitivity Mask" });
	sensFolder.addBinding(PARAMS, "sensitivityScale", { min: 0.5, max: 10.0, label: "Zone Size" });
	sensFolder.addBinding(PARAMS, "sensitivitySpeed", { min: 0.0, max: 1.0, label: "Evolution Speed" });
	sensFolder.addBinding(PARAMS, "sensitivityThreshold", { min: 0.0, max: 1.0, label: "Activity Level" });
	sensFolder.addBinding(PARAMS, "activeWordLimit", { min: 0.01, max: 1.0, label: "Word Density" });

	const stormFolder = pane.addFolder({ title: "The Storm Geometry" });
	stormFolder.addBinding(PARAMS, "useGhostReader", { label: "Auto Reading Storm" });
	stormFolder.addBinding(PARAMS, "lineSqueeze", { min: 10.0, max: 100.0, label: "Line Isolation" });
	stormFolder.addBinding(PARAMS, "stormRadius", { min: 0.1, max: 1.5 });

	const obsFolder = pane.addFolder({ title: "Invisible Obstacles" });
	obsFolder.addBinding(PARAMS, "circleX", { min: 0, max: 1.0, label: "Circle X" });
	obsFolder.addBinding(PARAMS, "circleY", { min: 0, max: 1.0, label: "Circle Y" });
	obsFolder.addBinding(PARAMS, "circleRadius", { min: 0.01, max: 0.5, label: "Radius" });
	obsFolder.addBinding(PARAMS, "repelStrength", { min: 0, max: 10000, step: 100 });

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

	let mouseClientX = vw / 2;
	let mouseClientY = vh / 2;
	window.addEventListener("mousemove", e => {
		mouseClientX = e.clientX;
		mouseClientY = e.clientY;
	});

	let WORD_COUNT: number = 0;
	let appScrollY = 0;

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
	if (!gl.getExtension("EXT_color_buffer_float")) console.error("EXT_color_buffer_float not supported!");

	//@ts-ignore
	await document.fonts.ready;
	const appEl = document.getElementById("app")!;
	$compile(book).mount(appEl);

	appEl.addEventListener(
		"scroll",
		() => {
			appScrollY = appEl.scrollTop;
		},
		{ passive: true },
	);

	const domNodes = Array.from(document.getElementsByClassName("word"));
	WORD_COUNT = domNodes.length;

	// Setting capacity allocates the exact backing Float32Arrays needed
	// for STATE.vals and REST.vals to be perfectly contiguous.
	ecs.setCapacity(WORD_COUNT);

	const rootFontSize = parseFloat(window.getComputedStyle(document.documentElement).fontSize);
	const wordsByPage: Record<number, number[]> = {};
	const pageDurations: Record<number, number> = {};

	for (let i = 0; i < WORD_COUNT; i++) {
		const el = domNodes[i] as HTMLElement;
		const rect = el.getBoundingClientRect();
		el.style.width = rect.width / rootFontSize + "rem";
		el.style.height = rect.height / rootFontSize + "rem";
		el.classList.add("frozen");

		const x = rect.left + rect.width * 0.5;
		const y = rect.top + appScrollY + rect.height * 0.5;
		const norm_x = x / vw;
		const norm_y = y / appEl.clientHeight;

		const parentPage = el.closest(".page");
		const pIndex = parentPage ? parseInt(parentPage.getAttribute("data-page-index")!) : 0;
		if (!wordsByPage[pIndex]) wordsByPage[pIndex] = [];
		wordsByPage[pIndex].push(i);

		const entity = ecs.defEntity([STATE, REST]);
		// Injecting 8 values: 4 for State, 4 for Velocity (starting at 0)
		STATE.set(entity, [CONFIG.restWght, CONFIG.restWdth, CONFIG.restItal, CONFIG.restCont, 0, 0, 0, 0]);
		REST.set(entity, [norm_x, norm_y]);
	}

	const BASE_WPM = 238.0;
	Object.keys(wordsByPage).forEach(pIdx => {
		const count = wordsByPage[parseInt(pIdx)].length;
		pageDurations[parseInt(pIdx)] = (count / BASE_WPM) * 60.0 * 0.6;
	});

	let activePageIndex = 0;
	let pageStartTime = performance.now();
	let ghostY = 0.5;

	const observer = new IntersectionObserver(
		entries => {
			entries.forEach(entry => {
				if (entry.isIntersecting) {
					const newIdx = parseInt(entry.target.getAttribute("data-page-index")!, 10);
					if (newIdx !== activePageIndex) {
						activePageIndex = newIdx;
						pageStartTime = performance.now();
					}
				}
			});
		},
		{ root: document.getElementById("app"), threshold: 0.5 },
	);
	document.querySelectorAll(".page").forEach(sec => observer.observe(sec));

	function updateGhostReader(now: number) {
		const elapsedSeconds = (now - pageStartTime) / 1000.0;
		const duration = pageDurations[activePageIndex] || 30.0;
		const pageProgress = Math.min(Math.max(elapsedSeconds / duration, 0), 1.0);
		ghostY = activePageIndex + pageProgress;
	}
	// ==========================================
	// THE NEWTONIAN PHYSICS SHADER (AST VERSION)
	// ==========================================
	const glsl = targetGLSL({ version: GLSLVersion.GLES_300 });

	const a_state = input("vec4", "a_state");
	const a_velocity = input("vec4", "a_velocity");
	const a_position = input("vec2", "a_position");
	const v_newState = output("vec4", "v_newState");
	const v_newVelocity = output("vec4", "v_newVelocity");

	const u_time = uniform("float", "u_time");
	const u_mouse = uniform("vec2", "u_mouse");
	const u_friction = uniform("float", "u_friction");
	const u_stiffness = uniform("float", "u_stiffness");
	const u_violence = uniform("float", "u_violence");
	const u_physicalLimit = uniform("float", "u_physicalLimit");
	const u_stormRadius = uniform("float", "u_stormRadius");
	const u_noiseScale = uniform("float", "u_noiseScale");
	const u_noiseSpeed = uniform("float", "u_noiseSpeed");
	const u_hurst = uniform("float", "u_hurst");
	const u_flowStrength = uniform("float", "u_flowStrength");
	const u_flowScale = uniform("float", "u_flowScale");
	const u_urgeRate = uniform("float", "u_urgeRate");
	const u_urgeDecay = uniform("float", "u_urgeDecay");
	const u_snapThreshold = uniform("float", "u_snapThreshold");
	const u_willpower = uniform("float", "u_willpower");
	const u_globalWindSpeed = uniform("float", "u_globalWindSpeed");
	const u_struggleChance = uniform("float", "u_struggleChance");
	const u_sensitivityScale = uniform("float", "u_sensitivityScale");
	const u_sensitivitySpeed = uniform("float", "u_sensitivitySpeed");
	const u_sensitivityThreshold = uniform("float", "u_sensitivityThreshold");
	const u_activeWordLimit = uniform("float", "u_activeWordLimit");
	const u_lineSqueeze = uniform("float", "u_lineSqueeze");
	const u_circlePos = uniform("vec2", "u_circlePos");
	const u_circleRadius = uniform("float", "u_circleRadius");
	const u_repelStrength = uniform("float", "u_repelStrength");
	const u_restState = uniform("vec4", "u_restState");

	const hash = defn("float", "hash", ["vec2"], p => [
		assign(p, fract(mul(p, vec2(123.34, 456.21)))),
		assign(p, add(p, dot(p, add(p, float(45.32))))),
		ret(fract(mul($x(p), $y(p)))),
	]);

	const fbm = defn("float", "fbm", ["vec3"], x => {
		const v = sym(float(0.0));
		const a = sym(float(0.5));
		const shift = sym(vec3(100.0));
		return [
			v,
			a,
			shift,
			// Expanded 3 octaves for performance/simplicity
			assign(v, add(v, mul(a, snoise3(x)))),
			assign(x, add(mul(x, float(2.0)), shift)),
			assign(a, mul(a, pow(float(2.0), neg(u_hurst)))),

			assign(v, add(v, mul(a, snoise3(x)))),
			assign(x, add(mul(x, float(2.0)), shift)),
			assign(a, mul(a, pow(float(2.0), neg(u_hurst)))),

			assign(v, add(v, mul(a, snoise3(x)))),
			assign(x, add(mul(x, float(2.0)), shift)),
			assign(a, mul(a, pow(float(2.0), neg(u_hurst)))),
			ret(v),
		];
	});

	const sdCircle = defn("float", "sdCircle", ["vec2", "float"], (p, r) => [ret(sub(length(p), r))]);

	const vsProgram = program([
		a_state,
		a_velocity,
		a_position,
		v_newState,
		v_newVelocity,
		u_time,
		u_mouse,
		u_friction,
		u_stiffness,
		u_violence,
		u_physicalLimit,
		u_stormRadius,
		u_noiseScale,
		u_noiseSpeed,
		u_hurst,
		u_flowStrength,
		u_flowScale,
		u_urgeRate,
		u_urgeDecay,
		u_snapThreshold,
		u_willpower,
		u_globalWindSpeed,
		u_struggleChance,
		u_sensitivityScale,
		u_sensitivitySpeed,
		u_sensitivityThreshold,
		u_activeWordLimit,
		u_lineSqueeze,
		u_circlePos,
		u_circleRadius,
		u_repelStrength,
		u_restState,
		hash,
		fbm,
		sdCircle,
		defMain(() => {
			const state = sym(a_state);
			const vel = sym(a_velocity);
			const dt = sym(float(0.016));

			// 1. THE LINE BACKER (STORM GEOMETRY)
			const stormVec = sym(sub(a_position, u_mouse));
			const behindReader = sym(smoothstep(float(0.25), float(0.0), sub($y(u_mouse), $y(a_position))));
			return [
				state,
				vel,
				dt,
				stormVec,
				behindReader,
				assign($y(stormVec), mul($y(stormVec), u_lineSqueeze)),
				...(() => {
					const stormDist = sym(length(stormVec));
					const baseMask = sym(sub(float(1.0), smoothstep(float(0.0), u_stormRadius, stormDist)));
					const stormMask = sym(mul(pow(baseMask, float(4.0)), behindReader));

					// --- THE NEUROLOGICAL STORM (URGE) ---
					const sensCoords = sym(vec3(mul(a_position, u_sensitivityScale), mul(u_time, u_sensitivitySpeed)));
					const noiseVal = sym(fbm(sensCoords));
					const sensitivity = sym(
						smoothstep(
							sub(sub(float(1.0), u_activeWordLimit), float(0.1)),
							sub(float(1.0), u_activeWordLimit),
							noiseVal,
						),
					);

					const circDist = sym(sdCircle(sub(a_position, u_circlePos), u_circleRadius));
					const irritation = sym(smoothstep(add(u_circleRadius, float(0.1)), u_circleRadius, circDist));
					const buildup = sym(mul(mul(add(mul(stormMask, float(5.0)), irritation), u_urgeRate), sensitivity));
					const resistance = sym(mul(u_willpower, float(5.0)));

					return [
						stormDist,
						baseMask,
						stormMask,
						sensCoords,
						noiseVal,
						sensitivity,
						circDist,
						irritation,
						buildup,
						resistance,
						assign($w(state), add($w(state), mul(max(sub(buildup, resistance), float(0.0)), dt))),
						assign(
							$w(state),
							mix($w(state), float(0.0), mix(mul(u_urgeDecay, float(10.0)), u_urgeDecay, behindReader)),
						),

						...(() => {
							const noiseCoords = sym(vec3(mul(a_position, u_noiseScale), mul(u_time, u_noiseSpeed)));
							const shiverHeat = sym(
								mul(
									pow(clamp(mul($w(state), float(0.2)), float(0.0), float(1.0)), float(3.0)),
									add(float(1.0), mul(u_willpower, float(2.0))),
								),
							);
							const turbulence = sym(
								mul(fbm(noiseCoords), add(float(1.0), mul(shiverHeat, float(10.0)))),
							);

							const windCoords = sym(vec3(float(0.0), float(0.0), mul(u_time, u_globalWindSpeed)));
							const windAngle = sym(mul(snoise3(windCoords), float(6.28)));
							const atmosphericWind = sym(
								mul(
									mul(mul(vec2(cos(windAngle), sin(windAngle)), u_flowStrength), float(0.5)),
									mul(sensitivity, stormMask),
								),
							);

							const flowCoords = sym(
								vec3(mul(a_position, u_flowScale), mul(u_time, mul(u_noiseSpeed, float(0.1)))),
							);
							const flowAngle = sym(mul(fbm(flowCoords), float(6.283185)));
							const flowForce = sym(
								mul(
									mul(vec2(cos(flowAngle), sin(flowAngle)), u_flowStrength),
									mul(sensitivity, stormMask),
								),
							);

							const explosiveForce = sym(float(0.0));
							return [
								noiseCoords,
								shiverHeat,
								turbulence,
								windCoords,
								windAngle,
								atmosphericWind,
								flowCoords,
								flowAngle,
								flowForce,
								explosiveForce,
								ifThen(gt($w(state), u_snapThreshold), [
									...(() => {
										const dice = sym(hash(add(a_position, u_time)));
										return [
											dice,
											ifThen(
												lt(dice, u_struggleChance),
												[
													assign(
														explosiveForce,
														mul(mul(turbulence, u_violence), float(4.0)),
													),
													assign($w(state), sub($w(state), float(1.5))),
												],
												[
													assign(
														explosiveForce,
														mul(mul(turbulence, u_violence), float(15.0)),
													),
													assign($w(state), float(-30.0)),
												],
											),
										];
									})(),
								]),

								...(() => {
									const mass = sym(clamp(sdiv($x(state), $x(u_restState)), float(0.5), float(3.0)));
									const force = sym(
										vec2(
											mul(neg(u_stiffness), sub($x(state), $x(u_restState))),
											mul(neg(u_stiffness), sub($y(state), $y(u_restState))),
										),
									);
									return [
										mass,
										force,
										assign(force, add(force, add(flowForce, atmosphericWind))),
										ifThen(gt(abs(explosiveForce), float(0.0)), [
											assign($x(vel), add($x(vel), mul(cos(windAngle), explosiveForce))),
											assign($y(vel), add($y(vel), mul(sin(windAngle), abs(explosiveForce)))),
										]),
										ifThen(lt(circDist, float(0.0)), [
											assign(
												force,
												add(
													force,
													mul(normalize(sub(a_position, u_circlePos)), u_repelStrength),
												),
											),
										]),
										...(() => {
											const accel = sym(sdiv(force, mass));
											return [
												accel,
												assign($xy(vel), mul(add($xy(vel), mul(accel, dt)), u_friction)),
												ifThen(
													and(
														lt(length(force), float(0.1)),
														lt(length($xy(vel)), float(0.1)),
													),
													[assign($xy(vel), mul($xy(vel), float(0.0)))],
												),
												assign($xy(state), add($xy(state), mul($xy(vel), dt))),

												ifThen(gt($x(state), float(900.0)), [
													assign($x(state), float(900.0)),
													assign($x(vel), mul($x(vel), float(-0.8))),
												]),
												ifThen(lt($x(state), float(47.0)), [
													assign($x(state), float(47.0)),
													assign($x(vel), mul($x(vel), float(-0.8))),
												]),
												ifThen(gt($y(state), float(140.0)), [
													assign($y(state), float(140.0)),
													assign($y(vel), mul($y(vel), float(-0.8))),
												]),
												ifThen(lt($y(state), u_physicalLimit), [
													assign($y(state), u_physicalLimit),
													assign($y(vel), mul($y(vel), float(-0.8))),
												]),

												...(() => {
													const shear = sym(mul($y(vel), float(0.25)));
													return [
														shear,
														assign(
															$z(state),
															mix(
																$z(state),
																clamp(abs(shear), float(0.0), float(12.0)),
																float(0.45),
															),
														),
														assign(v_newState, state),
														assign(v_newVelocity, vel),
													];
												})(),
											];
										})(),
									];
								})(),
							];
						})(),
					];
				})(),
			];
		}),
	]);

	const vsSource = (glsl as any)(vsProgram).replace("#version 300 es", "#version 300 es\nprecision highp float;");

	const fragColor = output("vec4", "fragColor");
	const fsProgram = program([fragColor, defMain(() => [assign(fragColor, vec4(0.0))])]);
	const fsSource = (glsl as any)(fsProgram).replace("#version 300 es", "#version 300 es\nprecision mediump float;");

	function compileShader(type: any, source: any) {
		const shader: WebGLShader = gl.createShader(type)!;
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(shader));
		return shader;
	}
	const glProgram = gl.createProgram()!;
	gl.attachShader(glProgram, compileShader(gl.VERTEX_SHADER, vsSource));
	gl.attachShader(glProgram, compileShader(gl.FRAGMENT_SHADER, fsSource));

	gl.transformFeedbackVaryings(glProgram, ["v_newState", "v_newVelocity"], gl.INTERLEAVED_ATTRIBS);
	gl.linkProgram(glProgram);

	const locs = {
		time: gl.getUniformLocation(glProgram, "u_time"),
		mouse: gl.getUniformLocation(glProgram, "u_mouse"),
		friction: gl.getUniformLocation(glProgram, "u_friction"),
		stiffness: gl.getUniformLocation(glProgram, "u_stiffness"),
		violence: gl.getUniformLocation(glProgram, "u_violence"),
		physicalLimit: gl.getUniformLocation(glProgram, "u_physicalLimit"),
		stormRadius: gl.getUniformLocation(glProgram, "u_stormRadius"),
		noiseScale: gl.getUniformLocation(glProgram, "u_noiseScale"),
		noiseSpeed: gl.getUniformLocation(glProgram, "u_noiseSpeed"),
		hurst: gl.getUniformLocation(glProgram, "u_hurst"),
		flowStrength: gl.getUniformLocation(glProgram, "u_flowStrength"),
		flowScale: gl.getUniformLocation(glProgram, "u_flowScale"),
		urgeRate: gl.getUniformLocation(glProgram, "u_urgeRate"),
		urgeDecay: gl.getUniformLocation(glProgram, "u_urgeDecay"),
		snapThreshold: gl.getUniformLocation(glProgram, "u_snapThreshold"),
		willpower: gl.getUniformLocation(glProgram, "u_willpower"),
		globalWindSpeed: gl.getUniformLocation(glProgram, "u_globalWindSpeed"),
		struggleChance: gl.getUniformLocation(glProgram, "u_struggleChance"),
		sensitivityScale: gl.getUniformLocation(glProgram, "u_sensitivityScale"),
		sensitivitySpeed: gl.getUniformLocation(glProgram, "u_sensitivitySpeed"),
		sensitivityThreshold: gl.getUniformLocation(glProgram, "u_sensitivityThreshold"),
		activeWordLimit: gl.getUniformLocation(glProgram, "u_activeWordLimit"),
		lineSqueeze: gl.getUniformLocation(glProgram, "u_lineSqueeze"),
		circlePos: gl.getUniformLocation(glProgram, "u_circlePos"),
		circleRadius: gl.getUniformLocation(glProgram, "u_circleRadius"),
		repelStrength: gl.getUniformLocation(glProgram, "u_repelStrength"),
		restState: gl.getUniformLocation(glProgram, "u_restState"),
	};

	const bufferA = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, bufferA);
	gl.bufferData(gl.ARRAY_BUFFER, STATE.vals, gl.DYNAMIC_COPY);

	const bufferB = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, bufferB);
	gl.bufferData(gl.ARRAY_BUFFER, STATE.vals, gl.DYNAMIC_COPY);

	const restBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, restBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, REST.vals, gl.STATIC_DRAW);

	const pingPongBuffers = [bufferA, bufferB];

	function bindVAO(buffer: WebGLBuffer) {
		const vao = gl.createVertexArray()!;
		gl.bindVertexArray(vao);
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		const stateLoc = gl.getAttribLocation(glProgram, "a_state");
		gl.enableVertexAttribArray(stateLoc);
		gl.vertexAttribPointer(stateLoc, 4, gl.FLOAT, false, 32, 0);
		const velLoc = gl.getAttribLocation(glProgram, "a_velocity");
		gl.enableVertexAttribArray(velLoc);
		gl.vertexAttribPointer(velLoc, 4, gl.FLOAT, false, 32, 16);
		gl.bindBuffer(gl.ARRAY_BUFFER, restBuffer);
		const posLoc = gl.getAttribLocation(glProgram, "a_position");
		gl.enableVertexAttribArray(posLoc);
		gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
		return vao;
	}

	const vaoA = bindVAO(bufferA);
	const vaoB = bindVAO(bufferB);
	gl.bindVertexArray(null);
	gl.bindBuffer(gl.ARRAY_BUFFER, null);

	const pbo = gl.createBuffer();
	gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
	gl.bufferData(gl.PIXEL_PACK_BUFFER, STATE.vals.byteLength, gl.STREAM_READ);
	gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);

	let readIndex = 0;
	let currentFence: WebGLSync | null = null;
	const previousState = new Float32Array(WORD_COUNT * 8);
	let lastTime = performance.now();
	let frameCount = 0;

	const raf$ = fromRAF({ timestamp: true });
	const db = defAtom({});

	if (!tsUI.firstChild) tsUI.appendChild(document.createTextNode(""));
	const fpsTextNode = tsUI.firstChild!;

	initGraph(db, {
		// 1. GPGPU Physics Compute Node
		gpu: {
			fn: ins =>
				ins.raf.map((now: any) => {
					const t = typeof now === "number" ? now : now.timestamp || performance.now();
					const currentTime = performance.now();
					frameCount++;
					if (currentTime >= lastTime + 1000) {
						fpsTextNode.nodeValue = `FPS: ${frameCount} | PAGE: ${activePageIndex} | GHOST: ${ghostY.toFixed(2)}`;
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
							gl.deleteSync(currentFence!);
							currentFence = null;
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
						updateGhostReader(t);

						const manualMouseX = mouseClientX / vw;
						const manualMouseY = (mouseClientY + appScrollY) / appEl.clientHeight;
						
						// In Ghost Mode, center the storm horizontally (0.5) and use the calculated ghostY
						const activeStormX = PARAMS.useGhostReader ? 0.5 : manualMouseX;
						const activeStormY = PARAMS.useGhostReader ? ghostY : manualMouseY;

						gl.uniform1f(locs.time, t * 0.001);
						gl.uniform2f(locs.mouse, activeStormX, activeStormY);
						gl.uniform1f(locs.friction, PARAMS.friction);
						gl.uniform1f(locs.stiffness, PARAMS.stiffness);
						gl.uniform1f(locs.violence, PARAMS.violence);
						gl.uniform1f(locs.physicalLimit, PARAMS.physicalLimit);
						gl.uniform1f(locs.stormRadius, PARAMS.stormRadius);
						gl.uniform1f(locs.noiseScale, PARAMS.noiseScale);
						gl.uniform1f(locs.noiseSpeed, PARAMS.noiseSpeed);
						gl.uniform1f(locs.hurst, PARAMS.hurst);
						gl.uniform1f(locs.flowStrength, PARAMS.flowStrength);
						gl.uniform1f(locs.flowScale, PARAMS.flowScale);
						gl.uniform1f(locs.urgeRate, PARAMS.urgeRate);
						gl.uniform1f(locs.urgeDecay, PARAMS.urgeDecay);
						gl.uniform1f(locs.snapThreshold, PARAMS.snapThreshold);
						gl.uniform1f(locs.willpower, PARAMS.willpower);
						gl.uniform1f(locs.globalWindSpeed, PARAMS.globalWindSpeed);
						gl.uniform1f(locs.struggleChance, PARAMS.struggleChance);
						gl.uniform1f(locs.sensitivityScale, PARAMS.sensitivityScale);
						gl.uniform1f(locs.sensitivitySpeed, PARAMS.sensitivitySpeed);
						gl.uniform1f(locs.sensitivityThreshold, PARAMS.sensitivityThreshold);
						gl.uniform1f(locs.activeWordLimit, PARAMS.activeWordLimit);
						gl.uniform1f(locs.lineSqueeze, PARAMS.lineSqueeze);
						gl.uniform2f(locs.circlePos, PARAMS.circleX, PARAMS.circleY);
						gl.uniform1f(locs.circleRadius, PARAMS.circleRadius);
						gl.uniform1f(locs.repelStrength, PARAMS.repelStrength);
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
						gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
						gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.PIXEL_PACK_BUFFER, 0, 0, STATE.vals.byteLength);
						gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
						gl.bindBuffer(gl.COPY_READ_BUFFER, null);
						currentFence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
						readIndex = writeIndex;
					}
					return emittedData;
				}),
			ins: { raf: { stream: () => raf$ } },
		},
		// 2. DOM Update Node
		ui: {
			fn: ins =>
				ins.gpu.map((state: Float32Array) => {
					if (!state) return;
					for (let i = 0; i < WORD_COUNT; i++) {
						const idx = i * 8;
						const wght = Math.round(state[idx] / 5) * 5;
						const wdth = Math.round(state[idx + 1] / 2) * 2;
						const ital = Math.round(state[idx + 2] * 10) / 10;

						if (
							wght !== previousState[idx] ||
							wdth !== previousState[idx + 1] ||
							ital !== previousState[idx + 2]
						) {
							const el = domNodes[i] as HTMLElement;
							el.style.setProperty("--wght", `${wght}`);
							el.style.setProperty("--wdth", `${wdth}`);
							el.style.setProperty("--ital", `${ital}`);
							previousState[idx] = wght;
							previousState[idx + 1] = wdth;
							previousState[idx + 2] = ital;
						}
					}
				}),
			ins: { gpu: { stream: "/gpu/node" } },
		},
	});
}

onAuthStateChanged(auth, user => {
	if (user) {
		main();
	} else {
		signInWithPopup(auth, googleProvider);
	}
});
