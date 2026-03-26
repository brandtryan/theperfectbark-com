import {
	$w,
	$x,
	$y,
	abs,
	add,
	assign,
	defn,
	float,
	gt,
	ifThen,
	mix,
	mul,
	// ret,
	sym,
	vec3,
} from "@thi.ng/shader-ast";
import { snoise3 } from "@thi.ng/shader-ast-stdlib";

// 1. Actual WebGL bindings defined as AST Symbols
export const a_particleData = sym("vec4", "a_particleData");
export const u_time = sym("float", "u_time");
export const u_force = sym("float", "u_force");
export const u_decay = sym("float", "u_decay");

// The 'out: true' flag tells the AST this is a varying/Transform Feedback target
export const v_newParticleData = sym("vec4", "v_newParticleData", { q: "out" });

// 1. Define AST function for the Physics pass
// This transpiles perfectly into a GLSL Vertex Shader
export const urgeReleaseKernel = defn(
	"void", // Return type
	"main", // Function name
	[], // Arguments
	() => {
		// 'sym' creates a typed variable in the shader
		let current = sym("vec4", "current");
		let restState = sym("vec4", "restState");
		let stormMask = sym("float", "stormMask");
		let urge = sym("float", "urge");
		let noiseForce = sym("float", "noiseForce");
		let explosiveForce = sym("float", "explosiveForce");

		return [
			// Read from attributes (Injected via WebGL)
			assign(current, a_particleData),

			// DISSIPATION & ACCUMULATION
			// Read the 'w' channel for our current urge, add the mask, and mix it down (cooling off)
			// Use $x() and $y() for type-safe AST component extraction
			assign(urge, add($w(current), mul(stormMask, float(0.8)))),
			// Mix down
			assign(urge, mix(urge, float(0.0), float(0.02))),

			// The FLOW FIELD (Noise)
			// Call stdlib 3d Simplex noise
			assign(noiseForce, snoise3(vec3($x(current), $y(current), u_time))),

			// The THRESHOLD (The Snap)
			assign(explosiveForce, float(0.0)),

			// ifThen(condition, [ ...trueBlock ])
			ifThen(gt(urge, float(35.0)), [
				assign(explosiveForce, mul(noiseForce, urge)),
				assign(urge, float(0.0)), // Reset tension
			]),

			// APPLY FORCE
			// Note: u_force is a uniform you'll need to define
			assign($x(current), add($x(current), mul(abs(explosiveForce), u_force))),

			// THE DECAY (Gravity back to rest)
			// Note: restState and u_decay need to be defined
			assign($x(current), mix($x(current), $x(restState), u_decay)),

			// Save the urge back into the W channel
			assign($w(current), urge),

			// Output to our Transform Feedback varying!
			assign(v_newParticleData, current),
		];
	},
);
