# The Perfect Bark - Project Context

This is an experimental, interactive digital book experience based on the text "The Perfect Bark." It uses advanced GPGPU physics to animate font morphology (weight, width, italics) in real-time, responding to user interaction and procedural forces.

## Project Overview

- **Core Purpose:** A high-performance interactive book where words behave as physical entities with mass, inertia, and spring-like "rest" states.
- **Main Technologies:**
    - **[@thi.ng/umbrella](https://thi.ng/):** Extensively used for ECS (`@thi.ng/ecs`), Atoms (`@thi.ng/atom`), Streams (`@thi.ng/rstream`), and GPGPU/WebGL2 (`@thi.ng/webgl`).
    - **WebGL2 Transform Feedback:** Computes Newtonian physics for thousands of words simultaneously on the GPU.
    - **Vite:** Build tool and development server.
    - **Firebase:** Google Authentication and Hosting.
    - **Tweakpane:** Provides a "Phenomenology Controls" UI for real-time parameter tuning.
    - **Variable Fonts:** Uses the `Ikarus` variable font with custom axes.

## Architecture & Implementation

### 1. The GPGPU Compute Engine (`src/index.ts`)
- **Type-Safe Physics Kernel:** The physics engine is defined declaratively using `@thi.ng/shader-ast`. This provides a TypeScript-verified environment for complex 5D phase-space math (Verlet integration, FBM noise, SDFs), which is then compiled to GLSL ES 3.0.
- **WebGL2 Transform Feedback:** Computes Newtonian physics for thousands of words simultaneously on the GPU. Unlike traditional GPGPU, this uses direct buffer-to-buffer compute, bypassing the "texture/fragment" bottleneck.
- **Asynchronous, Non-Blocking Pipeline:** Leverages `gl.fenceSync` within a `@thi.ng/rstream-graph` to ensure the GPU compute does not block the CPU main thread. Data is only read back from the GPU once the sync object is signaled.
- **Headless Compute:** Runs via an `OffscreenCanvas` never appended to the DOM.
- **Interleaved Buffers:** Stores word states (8 floats: `wght`, `wdth`, `ital`, `urge`, and their respective velocities) in a contiguous memory layout.
- **Physics Kernel Features:**
    - **Newtonian Kinetics:** Implements Hooke's Law (springs) to pull words back to their `REST` configuration.
    - **Vector Flow Fields:** Uses Fractal Brownian Motion (FBM) noise to derive direction vectors that "blow" the words.
    - **SDF Obstacles:** Uses Signed Distance Fields (circles, boxes) to create invisible boundaries that repel the text.
    - **Urge Accumulation:** Words accumulate an "urge" (via an oval mouse mask or "Ghost Reader") which can trigger explosive "stochastic" movements.

### 2. Entity Component System (`src/memory.ts`)
- Manages word entities using `@thi.ng/ecs`.
- **Components:**
    - `STATE`: Contiguous Float32Array holding the 8-float physics state.
    - `REST`: Anchor positions for each word.

### 3. Content & UI
- **Reactive DOM:** Content is defined in `src/html.ts` using `@thi.ng/hiccup-html` and compiled with `@thi.ng/rdom`.
- **Surgical DOM Updates:** The `ui` graph node iterates over the GPU result buffer and mutates CSS Custom Properties directly.
- **Snapping Scroll:** Uses CSS Scroll Snapping for a page-by-page reading experience.
- **Quantization:** Aggressively quantizes physics values before updating CSS variables to minimize browser reflows and cache rasterized glyphs.

## Commands

- **Development:** `yarn dev` - Starts the Vite dev server.
- **Build:** `yarn build` - Runs `tsc` and `vite build`.
- **Preview:** `yarn preview` - Previews the production build locally.
- **Deploy:** `firebase deploy` - Deploys to Firebase Hosting.

## Development Conventions

- **Performance Mandate:** Always prioritize GPGPU and contiguous memory (ECS) for animations involving large numbers of elements. Avoid standard DOM-heavy animation libraries.
- **Interaction Design:** Use Tweakpane to expose "phenomenological" parameters (stiffness, friction, violence, etc.) for interactive design.
- **Shader-First Logic:** Move complex spatial logic (SDFs, Noise, Flow Fields) into the vertex shader to leverage the GPU.
- **@thi.ng Idioms:** Prefer `@thi.ng` data structures and reactive patterns (streams, graphs) over vanilla state management.
