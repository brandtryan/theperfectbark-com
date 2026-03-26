import { exposeGlobal } from "@thi.ng/expose";
import { ECS } from "@thi.ng/ecs";

interface CompSpecs {
	state: Float32Array;
	rest: Float32Array;
	// page: Uint16Array;
}

// creates world
export const ecs = new ECS<CompSpecs>({});

// morphological physics state
export const STATE = ecs.defComponent<"state">({
	id: "state",
	type: "f32",
	size: 4, // "wght", "wdth", "ital", "urge"
})!;

// anchor position of entities (fire and forget)
export const REST = ecs.defComponent<"rest">({
	id: "rest",
	type: "f32",
	size: 4, // x, y, width, page
	// don't need to store height
	// every line on page is always 1/20th of vh
})!;

// // lookup for entities page location
// export const PAGE = ecs.defComponent<"page">({
// 	id: "page",
// 	type: "u16",
// 	size: 1,
// })!;

// Create entities
// INDEX is king and for any given entitity, it's
// entityid === it's index in any of the component buffers
// above.
export function initMemory(wordCount: number) {
	for (let i = 0; i < wordCount; i++) {
		ecs.defEntity([STATE.id, REST.id]);
	}
}
// custom function from thi.ng that allows me to check any
// part of ECS from console in browser
exposeGlobal("ecs", ecs, true);
