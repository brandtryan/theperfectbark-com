import { exposeGlobal } from "@thi.ng/expose";
import { ECS } from "@thi.ng/ecs";

interface CompSpecs {
	state: Float32Array;
	rest: Float32Array;
}

export const ecs = new ECS<CompSpecs>({});

// NEW: Expanded to 8 floats to hold True Physics Velocity!
// [wght, wdth, ital, urge,  v_wght, v_wdth, v_ital, v_urge]
export const STATE = ecs.defComponent<"state">({
	id: "state",
	type: "f32",
	size: 8,
})!;

// Absolute anchor position
export const REST = ecs.defComponent<"rest">({
	id: "rest",
	type: "f32",
	size: 2, // x, y
})!;

exposeGlobal("ecs", ecs, true);
