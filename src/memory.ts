import { exposeGlobal } from "@thi.ng/expose";
import { ECS } from "@thi.ng/ecs";

interface CompSpecs {
	state: Float32Array;
	rest: Float32Array;
}

// creates world
export const ecs = new ECS<CompSpecs>({});

// morphological physics state
export const STATE = ecs.defComponent<"state">({
	id: "state",
	type: "f32",
	size: 4, // "wght", "wdth", "ital", "urge"
})!;

// anchor position of entities
// OPTIMIZATION: Dropped to size 2! We only need absolute X and Y now.
export const REST = ecs.defComponent<"rest">({
	id: "rest",
	type: "f32",
	size: 2, // x, y
})!;

export function initMemory(wordCount: number) {
	for (let i = 0; i < wordCount; i++) {
		ecs.defEntity([STATE.id, REST.id]);
	}
}

exposeGlobal("ecs", ecs, true);
