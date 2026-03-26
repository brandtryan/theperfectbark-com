import { fromRAF } from "@thi.ng/rstream";
import { initGraph } from "@thi.ng/rstream-graph";
import { defAtom } from "@thi.ng/atom";
import {
	activePageIndex,
	fpsTextNode,
	gl,
	domNodes,
	PARAMS,
	mouseX,
	mouseY,
	locs,
	CONFIG,
	pingPongBuffers,
	wordsByPage,
	pbo,
	vaoA,
	vaoB,
} from "./index";
import { ecs, STATE, REST, PAGE } from "./memory";
import { program } from "@thi.ng/shader-ast";

let readIndex = 0;
let currentFence = null!;
let lastTime = performance.now();
let frameCount = 0;

const raf$ = fromRAF({ timestamp: true });

const db = defAtom({});

const previousState = new Float32Array(STATE.size);

initGraph(db, {
	gpuNode: {
		fn: (inputs) =>
			inputs.raf.map((now) => {
				const currentTime = performance.now();
				frameCount++;
				if (currentTime >= lastTime + 1000) {
					fpsTextNode.nodeValue = `COMPUTE FPS: ${frameCount} | WORDS: ${ecs.idgen.ids.length}`;
					frameCount = 0;
					lastTime = currentTime;
				}

				let emittedData = null;

				if (currentFence) {
					const status = gl.clientWaitSync(currentFence, 0, 0);
					if (
						status === gl.ALREADY_SIGNALED ||
						status === gl.CONDITION_SATISFIED
					) {
						gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
						gl.getBufferSubData(
							gl.PIXEL_PACK_BUFFER,
							0,
							STATE.vals,
						);
						gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
						gl.deleteSync(currentFence);
						currentFence as any;
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
					gl.bindBufferBase(
						gl.TRANSFORM_FEEDBACK_BUFFER,
						0,
						outputBuffer,
					);

					gl.enable(gl.RASTERIZER_DISCARD);
					gl.beginTransformFeedback(gl.POINTS);
					gl.drawArrays(gl.POINTS, 0, ecs.idgen.ids.length);
					gl.endTransformFeedback();
					gl.disable(gl.RASTERIZER_DISCARD);

					gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
					gl.bindVertexArray(null);

					gl.bindBuffer(gl.COPY_READ_BUFFER, outputBuffer);
					gl.bindBuffer(gl.COPY_WRITE_BUFFER, pbo);
					gl.copyBufferSubData(
						gl.COPY_READ_BUFFER,
						gl.COPY_WRITE_BUFFER,
						0,
						0,
						STATE.vals.byteLength,
					);
					gl.bindBuffer(gl.COPY_READ_BUFFER, null);
					gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);

					// @ts-ignore
					currentFence = gl.fenceSync(
						gl.SYNC_GPU_COMMANDS_COMPLETE,
						0,
					);
					gl.flush();
					readIndex = writeIndex;
				}
				return emittedData;
			}),
		ins: { raf: { stream: () => raf$ } },
	},

	uiNode: {
		fn: (inputs) =>
			inputs.gpu.subscribe({
				next: (ecsData) => {
					if (!ecsData) return;
					const activeIndices = wordsByPage[activePageIndex] || [];

					for (let j = 0; j < activeIndices.length; j++) {
						const i = activeIndices[j];
						const idx = i * 4;
						const el: any = domNodes[i];

						let wght = Math.round(ecsData[idx]);
						let wdth = Math.round(ecsData[idx + 1]);
						let ital = Math.round(ecsData[idx + 2]);

						// THE GOLDEN RATIO FIX: CPU Snap-to-Rest
						// letely kills the invisible "tail" of exponential decay
						if (Math.abs(wght - CONFIG.restWght) < 5)
							wght = CONFIG.restWght;
						if (Math.abs(wdth - CONFIG.restWdth) < 5)
							wdth = CONFIG.restWdth;
						if (Math.abs(ital - CONFIG.restItal) < 1)
							ital = CONFIG.restItal;

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
