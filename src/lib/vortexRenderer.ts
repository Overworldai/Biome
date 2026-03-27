/**
 * Vortex Renderer — WebGL2 particle tunnel effect
 *
 * Renders a radial streak tunnel (à la Windows XP "Starfield" screensaver) using
 * raw WebGL2 with no external dependencies. Used for both the portal hover preview
 * and the full-screen loading background.
 *
 * ## Why raw WebGL2?
 * The entire effect is a single draw call — one VBO of quads, one fragment shader,
 * additive blending. Pulling in Three.js (~150KB+) for this would be massive overkill.
 * WebGL2 is guaranteed available in our Electron/Chromium environment.
 *
 * ## Why quads instead of GL_LINES or GL_POINTS?
 * - `gl.POINTS` renders circles, not streaks — wrong shape entirely.
 * - `gl.LINES` is capped at 1px width on most GPUs (the spec allows implementations
 *   to limit `lineWidth` to 1). We need variable-width streaks.
 * - Screen-space quads (4 vertices, 6 indices per streak) give us full control over
 *   width and per-vertex brightness (bright head, dim tail).
 *
 * ## Particle lifecycle
 * Particles are recycled, never allocated/freed. Each particle has a z position
 * (0 = far end of tunnel, 1 = camera plane). When z > 1.0, the particle is respawned
 * at z ≈ 0 with new random attributes. Fade-in from z=0→0.1 and fade-out from
 * z=0.85→1.0 prevent popping. All particles spawn spread across the full z range
 * (not ramped in over time) to avoid a visible "wave" of particles arriving together.
 *
 * ## Perspective math
 * Each particle's screen position is computed as:
 *   perspective = 1 / (1 + (1 - z) * DEPTH)
 *   screenPos = cylindrical_pos * perspective
 *
 * This maps z=0 (far) to a small central point and z=1 (near) to full radius.
 * IMPORTANT: z values > 1.0 cause the perspective factor to exceed 1.0, which
 * inverts the projection and creates an "exploding warp core" effect. Particles
 * must be recycled at z = 1.0, not beyond.
 *
 * ## Bloom pipeline
 * After rendering streaks to an FBO, the image is downsampled and blurred via two
 * iterations of separable 13-tap Gaussian blur, then additively composited back
 * onto the scene. Requires `EXT_color_buffer_float` for RGBA16F render targets
 * (without this extension, the FBOs are incomplete and rendering is black).
 *
 * ## Canvas sharing
 * A single `<canvas>` element and WebGL context are shared across the app via
 * VortexContext. The canvas is physically reparented between DOM containers
 * (portal preview ↔ loading screen) to avoid creating multiple GL contexts.
 * See VortexContext.tsx for the reparenting mechanism.
 */

// --- Goose sprite constants ---
export const GOOSE_MAX_COUNT = 10
export const GOOSE_FRAME_COUNT = 6
export const GOOSE_FPS = 6
export const GOOSE_SPEED_MIN = 0.3
export const GOOSE_SPEED_MAX = 0.7
export const GOOSE_RADIUS_MIN = 0.5
export const GOOSE_RADIUS_MAX = 2.5
export const GOOSE_MIN_SCALE = 0.01
export const GOOSE_MAX_SCALE = 0.12
export const GOOSE_FADE_IN_END = 0.15
export const GOOSE_FADE_OUT_START = 0.85

// Goose particle fields
const G_ANGLE = 0
const G_RADIUS = 1
const G_Z = 2
const G_SPEED = 3
const G_FRAME_OFFSET = 4
const G_TILT = 5
const G_ANIM_TIME = 6
const G_SIZE_MULT = 7 // per-goose size variation (0.7–1.3)
const G_HUE_SHIFT = 8 // per-goose hue shift in radians
const G_BRIGHTNESS = 9 // per-goose brightness variation (0.8–1.1)
const GOOSE_FLOATS_PER_PARTICLE = 10

// Per-instance data: center(2) + scale(1) + rotation(1) + frame(1) + alpha(1) + flipX(1) + colorShift(3) = 10 floats
const GOOSE_INSTANCE_FLOATS = 10

// Minimum angular separation (radians) between geese at similar z depths
const GOOSE_MIN_ANGLE_SEP = Math.PI / 4 // 45 degrees
const GOOSE_MIN_Z_SEP = 0.15

/**
 * Check if a candidate (angle, z) is too close to any existing goose.
 * "Close" means both angularly near AND at a similar depth.
 */
function isGooseTooClose(
  particles: Float32Array,
  count: number,
  skipOffset: number,
  candidateAngle: number,
  candidateZ: number
): boolean {
  for (let i = 0; i < count; i++) {
    const off = i * GOOSE_FLOATS_PER_PARTICLE
    if (off === skipOffset) continue
    const oz = particles[off + G_Z]
    if (Math.abs(oz - candidateZ) > GOOSE_MIN_Z_SEP) continue
    // Angular distance on the circle
    let da = Math.abs(particles[off + G_ANGLE] - candidateAngle) % (Math.PI * 2)
    if (da > Math.PI) da = Math.PI * 2 - da
    if (da < GOOSE_MIN_ANGLE_SEP) return true
  }
  return false
}

function randomGoose(out: Float32Array, offset: number, spreadZ: boolean, index = -1, total = 1): void {
  if (spreadZ && index >= 0) {
    out[offset + G_ANGLE] = (index / total) * Math.PI * 2 + (Math.random() - 0.5) * 0.5
    out[offset + G_Z] = (index + Math.random()) / total
  } else {
    // Try to find a position that doesn't overlap with existing geese
    const z = Math.random() * 0.05
    let angle = Math.random() * Math.PI * 2
    for (let attempt = 0; attempt < 8; attempt++) {
      if (!isGooseTooClose(out, total, offset, angle, z)) break
      angle = Math.random() * Math.PI * 2
    }
    out[offset + G_ANGLE] = angle
    out[offset + G_Z] = z
  }
  out[offset + G_RADIUS] = GOOSE_RADIUS_MIN + Math.random() * (GOOSE_RADIUS_MAX - GOOSE_RADIUS_MIN)
  out[offset + G_SPEED] = GOOSE_SPEED_MIN + Math.random() * (GOOSE_SPEED_MAX - GOOSE_SPEED_MIN)
  out[offset + G_FRAME_OFFSET] = Math.floor(Math.random() * GOOSE_FRAME_COUNT)
  out[offset + G_TILT] = (Math.random() - 0.5) * 0.5 // ±~14 degrees
  out[offset + G_ANIM_TIME] = Math.random() * GOOSE_FRAME_COUNT // random start phase
  out[offset + G_SIZE_MULT] = 0.7 + Math.random() * 0.6 // 0.7–1.3
  out[offset + G_HUE_SHIFT] = (Math.random() - 0.5) * 0.3 // ±0.15 radians (~±9°)
  out[offset + G_BRIGHTNESS] = 0.85 + Math.random() * 0.25 // 0.85–1.1
}

// --- Tuning constants (exported for easy tweaking) ---
export const VORTEX_MAX_PARTICLES = 3000
export const VORTEX_PORTAL_COUNT = 800
export const VORTEX_LOADING_COUNT = 1320
export const VORTEX_SPEED_MIN = 0.375
export const VORTEX_SPEED_MAX = 0.9375
export const VORTEX_RADIUS_MIN = 0.02
export const VORTEX_RADIUS_MAX = 3.5
export const VORTEX_WIDTH_MIN = 0.003
export const VORTEX_WIDTH_MAX = 0.012
export const VORTEX_BRIGHTNESS_MIN = 0.4
export const VORTEX_BRIGHTNESS_MAX = 1.0
export const VORTEX_STREAK_LENGTH = 0.12
export const VORTEX_PERSPECTIVE_DEPTH = 5.0
export const VORTEX_TAIL_BRIGHTNESS = 0.3
export const VORTEX_FADE_IN_END = 0.1
export const VORTEX_HOT_STREAK_CHANCE = 0.08
export const VORTEX_HOT_STREAK_BRIGHTNESS = 2.0
export const VORTEX_BLOOM_INTENSITY = 3.0
export const VORTEX_BLOOM_DOWNSAMPLE = 2
export const VORTEX_BLOOM_BLUR_SPREAD = 2.0

/** Runtime-tweakable settings */
export type VortexSettings = {
  bloomEnabled: boolean
  bloomIntensity: number
  bloomBlurSpread: number
  bloomDownsample: number
}

const DEFAULT_SETTINGS: VortexSettings = {
  bloomEnabled: true,
  bloomIntensity: VORTEX_BLOOM_INTENSITY,
  bloomBlurSpread: VORTEX_BLOOM_BLUR_SPREAD,
  bloomDownsample: VORTEX_BLOOM_DOWNSAMPLE
}

// --- Streak shaders ---
// Vertex shader receives pre-computed screen-space quad positions (CPU does the
// perspective projection). Each vertex carries brightness and colorType for
// per-vertex coloring (head brighter than tail).
const STREAK_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_pos;
layout(location = 1) in float a_brightness;
layout(location = 2) in float a_colorType;

out float v_brightness;
out float v_colorType;

void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_brightness = a_brightness;
  v_colorType = a_colorType;
}
`

const STREAK_FS = `#version 300 es
precision highp float;

in float v_brightness;
in float v_colorType;

uniform vec3 u_palette[8];

out vec4 fragColor;

void main() {
  int idx = clamp(int(v_colorType + 0.5), 0, 7);
  vec3 color = u_palette[idx];
  fragColor = vec4(color * v_brightness, v_brightness);
}
`

// --- Bloom shaders ---
// Shared fullscreen-quad vertex shader for blur and composite passes.
// Blur uses a 13-tap (7-weight) Gaussian kernel with configurable spread.
// Composite additively blends the blurred bloom texture onto the scene.
const BLOOM_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_pos;
out vec2 v_uv;

void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

const BLUR_FS = `#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_dir;

out vec4 fragColor;

void main() {
  float weights[7] = float[](0.1964826, 0.1748941, 0.1225309, 0.0676075, 0.0293988, 0.0100749, 0.0027198);
  vec3 result = texture(u_tex, v_uv).rgb * weights[0];
  for (int i = 1; i < 7; i++) {
    vec2 off = u_dir * float(i);
    result += texture(u_tex, v_uv + off).rgb * weights[i];
    result += texture(u_tex, v_uv - off).rgb * weights[i];
  }
  fragColor = vec4(result, 1.0);
}
`

const COMPOSITE_FS = `#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_bloom;
uniform float u_intensity;

out vec4 fragColor;

void main() {
  vec3 bloom = texture(u_bloom, v_uv).rgb * u_intensity;
  fragColor = vec4(bloom, 1.0);
}
`

// --- Goose sprite shaders (instanced) ---
// A single unit quad is drawn N times via instancing. Each instance carries
// center position, scale, rotation angle, animation frame, and alpha.
// The vertex shader builds the full transform so no CPU-side rotation is needed.
const GOOSE_VS = `#version 300 es
precision highp float;

// Per-vertex (unit quad)
layout(location = 0) in vec2 a_quadPos;  // [-1,1] corners
layout(location = 1) in vec2 a_quadUV;   // [0,1] base UVs

// Per-instance
layout(location = 2) in vec2 a_center;   // clip-space center
layout(location = 3) in float a_scale;   // uniform scale in clip-space height units
layout(location = 4) in float a_rotation; // radians
layout(location = 5) in float a_frame;   // sprite frame index
layout(location = 6) in float a_alpha;
layout(location = 7) in float a_flipX;  // 1.0 to mirror horizontally, 0.0 normal
layout(location = 8) in vec3 a_colorTint; // per-goose color variation

uniform float u_aspect;       // viewport width / height
uniform float u_spriteAspect; // sprite frame width / height
uniform float u_frameCount;   // number of frames in spritesheet

out vec2 v_uv;
out float v_alpha;
out vec3 v_colorTint;

void main() {
  // Work in square (aspect-corrected) space for rotation, then convert to clip space.
  // Unit quad scaled by sprite proportions in square space:
  vec2 local = a_quadPos * vec2(a_scale * u_spriteAspect, a_scale);

  // Rotate in square space (no distortion)
  float c = cos(a_rotation);
  float s = sin(a_rotation);
  vec2 rotated = vec2(local.x * c - local.y * s, local.x * s + local.y * c);

  // Convert from square space to clip space by compressing X
  rotated.x /= u_aspect;

  gl_Position = vec4(a_center + rotated, 0.0, 1.0);

  // Compute spritesheet UV: offset base U by frame, flip if needed
  float frameWidth = 1.0 / u_frameCount;
  float u = mix(a_quadUV.x, 1.0 - a_quadUV.x, a_flipX);
  v_uv = vec2(u * frameWidth + a_frame * frameWidth, a_quadUV.y);
  v_alpha = a_alpha;
  v_colorTint = a_colorTint;
}
`

const GOOSE_FS = `#version 300 es
precision highp float;

in vec2 v_uv;
in float v_alpha;
in vec3 v_colorTint;

uniform sampler2D u_spritesheet;

out vec4 fragColor;

void main() {
  vec4 texel = texture(u_spritesheet, v_uv);
  fragColor = vec4(texel.rgb * v_colorTint, texel.a * v_alpha);
}
`

// --- Palette uploaded to u_palette[8] in the streak fragment shader ---
// Slots 0-3: normal (blue), slots 4-7: error (red)
// prettier-ignore
const PALETTE = new Float32Array([
  0.08, 0.15, 0.95,   // 0 — deep blue
  0.2,  0.4,  1.0,    // 1 — medium blue
  0.1,  0.55, 1.0,    // 2 — cyan-blue
  0.55, 0.75, 1.0,    // 3 — light blue
  0.95, 0.08, 0.08,   // 4 — deep red
  1.0,  0.2,  0.15,   // 5 — medium red
  1.0,  0.1,  0.05,   // 6 — orange-red
  1.0,  0.55, 0.45,   // 7 — salmon
])

// CPU particle fields — indices into the per-particle Float32Array stride
const P_ANGLE = 0
const P_RADIUS = 1
const P_Z = 2
const P_SPEED = 3
const P_BRIGHTNESS = 4
const P_COLOR_TYPE = 5
const P_WIDTH = 6
const FLOATS_PER_PARTICLE = 7

const FLOATS_PER_VERTEX = 4
const VERTS_PER_QUAD = 4
const INDICES_PER_QUAD = 6

/**
 * Initialize or respawn a particle with random attributes.
 * @param resetZ If true, spawn near z=0 (far end). If false, spread across full depth
 *               (used for initial population to avoid a visible wave of particles).
 */
function randomParticle(out: Float32Array, offset: number, resetZ: boolean, error = false): void {
  out[offset + P_ANGLE] = Math.random() * Math.PI * 2
  out[offset + P_RADIUS] = VORTEX_RADIUS_MIN + Math.random() * (VORTEX_RADIUS_MAX - VORTEX_RADIUS_MIN)
  out[offset + P_Z] = resetZ ? Math.random() * 0.05 : Math.random()
  out[offset + P_SPEED] = VORTEX_SPEED_MIN + Math.random() * (VORTEX_SPEED_MAX - VORTEX_SPEED_MIN)

  const isHot = Math.random() < VORTEX_HOT_STREAK_CHANCE
  const baseBrightness = VORTEX_BRIGHTNESS_MIN + Math.random() * (VORTEX_BRIGHTNESS_MAX - VORTEX_BRIGHTNESS_MIN)
  out[offset + P_BRIGHTNESS] = isHot ? baseBrightness * VORTEX_HOT_STREAK_BRIGHTNESS : baseBrightness

  out[offset + P_WIDTH] = VORTEX_WIDTH_MIN + Math.random() * (VORTEX_WIDTH_MAX - VORTEX_WIDTH_MIN)

  const roll = Math.random()
  const baseType = roll < 0.4 ? 0 : roll < 0.65 ? 1 : roll < 0.85 ? 2 : 3
  out[offset + P_COLOR_TYPE] = error ? baseType + 4 : baseType
}

export class VortexRenderer {
  private gl: WebGL2RenderingContext | null = null

  private streakProgram: WebGLProgram | null = null
  private streakVao: WebGLVertexArrayObject | null = null
  private streakVbo: WebGLBuffer | null = null
  private streakIbo: WebGLBuffer | null = null

  private blurProgram: WebGLProgram | null = null
  private compositeProgram: WebGLProgram | null = null
  private bloomQuadVao: WebGLVertexArrayObject | null = null
  private bloomQuadVbo: WebGLBuffer | null = null
  private sceneFbo: WebGLFramebuffer | null = null
  private sceneTex: WebGLTexture | null = null
  private pingFbo: WebGLFramebuffer | null = null
  private pingTex: WebGLTexture | null = null
  private pongFbo: WebGLFramebuffer | null = null
  private pongTex: WebGLTexture | null = null
  private bloomW = 0
  private bloomH = 0

  private paletteLoc: WebGLUniformLocation | null = null

  private blurDirLoc: WebGLUniformLocation | null = null
  private blurTexLoc: WebGLUniformLocation | null = null
  private compositeBloomLoc: WebGLUniformLocation | null = null
  private compositeIntensityLoc: WebGLUniformLocation | null = null

  private particles: Float32Array
  private quadVerts: Float32Array
  private indices: Uint32Array
  private _activeCount = 0
  private _targetCount = 800
  private width = 0
  private height = 0
  private contextLost = false
  private viewWarpX = 1
  private viewWarpY = 1
  private speedMultiplier = 1
  private _errorMode = false
  private _gooseEnabled = false
  private _gooseCount = 8

  // Goose sprite state (instanced rendering)
  private gooseProgram: WebGLProgram | null = null
  private gooseVao: WebGLVertexArrayObject | null = null
  private gooseQuadVbo: WebGLBuffer | null = null
  private gooseInstanceVbo: WebGLBuffer | null = null
  private gooseSpritesheetTex: WebGLTexture | null = null
  private gooseUniforms: {
    spritesheet: WebGLUniformLocation | null
    aspect: WebGLUniformLocation | null
    spriteAspect: WebGLUniformLocation | null
    frameCount: WebGLUniformLocation | null
  } = { spritesheet: null, aspect: null, spriteAspect: null, frameCount: null }
  private gooseParticles: Float32Array
  private gooseInstanceData: Float32Array

  settings: VortexSettings = { ...DEFAULT_SETTINGS }

  private handleContextLost: (e: Event) => void
  private handleContextRestored: () => void

  constructor(private canvas: HTMLCanvasElement) {
    this.particles = new Float32Array(VORTEX_MAX_PARTICLES * FLOATS_PER_PARTICLE)
    this.quadVerts = new Float32Array(VORTEX_MAX_PARTICLES * VERTS_PER_QUAD * FLOATS_PER_VERTEX)

    this.indices = new Uint32Array(VORTEX_MAX_PARTICLES * INDICES_PER_QUAD)
    for (let i = 0; i < VORTEX_MAX_PARTICLES; i++) {
      const vi = i * VERTS_PER_QUAD
      const ii = i * INDICES_PER_QUAD
      this.indices[ii] = vi
      this.indices[ii + 1] = vi + 1
      this.indices[ii + 2] = vi + 2
      this.indices[ii + 3] = vi + 2
      this.indices[ii + 4] = vi + 1
      this.indices[ii + 5] = vi + 3
    }

    // Goose buffers
    this.gooseParticles = new Float32Array(GOOSE_MAX_COUNT * GOOSE_FLOATS_PER_PARTICLE)
    this.gooseInstanceData = new Float32Array(GOOSE_MAX_COUNT * GOOSE_INSTANCE_FLOATS)
    // Spawn initial geese evenly distributed in angle and depth
    for (let i = 0; i < GOOSE_MAX_COUNT; i++) {
      randomGoose(this.gooseParticles, i * GOOSE_FLOATS_PER_PARTICLE, true, i, GOOSE_MAX_COUNT)
    }

    this.handleContextLost = (e: Event) => {
      e.preventDefault()
      this.contextLost = true
    }
    this.handleContextRestored = () => {
      this.contextLost = false
      this.initGL()
    }

    canvas.addEventListener('webglcontextlost', this.handleContextLost)
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored)

    this.initGL()
  }

  private initGL(): void {
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      powerPreference: 'default'
    })
    if (!gl) return

    this.gl = gl
    // Required for RGBA16F render targets used by the bloom pipeline.
    // Without this, FBOs are incomplete → GL_INVALID_FRAMEBUFFER_OPERATION.
    gl.getExtension('EXT_color_buffer_float')

    // --- Streak program ---
    this.streakProgram = this.buildProgram(STREAK_VS, STREAK_FS)
    if (!this.streakProgram) return

    this.streakVao = gl.createVertexArray()!
    gl.bindVertexArray(this.streakVao)

    this.streakVbo = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.streakVbo)
    gl.bufferData(gl.ARRAY_BUFFER, this.quadVerts.byteLength, gl.DYNAMIC_DRAW)

    const stride = FLOATS_PER_VERTEX * 4
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 8)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 12)

    this.streakIbo = gl.createBuffer()!
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.streakIbo)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indices, gl.STATIC_DRAW)
    gl.bindVertexArray(null)

    this.paletteLoc = gl.getUniformLocation(this.streakProgram, 'u_palette')

    // --- Bloom programs ---
    this.blurProgram = this.buildProgram(BLOOM_VS, BLUR_FS)
    this.compositeProgram = this.buildProgram(BLOOM_VS, COMPOSITE_FS)

    if (this.blurProgram) {
      this.blurDirLoc = gl.getUniformLocation(this.blurProgram, 'u_dir')
      this.blurTexLoc = gl.getUniformLocation(this.blurProgram, 'u_tex')
    }
    if (this.compositeProgram) {
      this.compositeBloomLoc = gl.getUniformLocation(this.compositeProgram, 'u_bloom')
      this.compositeIntensityLoc = gl.getUniformLocation(this.compositeProgram, 'u_intensity')
    }

    // Fullscreen quad
    this.bloomQuadVao = gl.createVertexArray()!
    gl.bindVertexArray(this.bloomQuadVao)
    this.bloomQuadVbo = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bloomQuadVbo)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)

    // --- Goose sprite program (instanced) ---
    this.gooseProgram = this.buildProgram(GOOSE_VS, GOOSE_FS)
    if (this.gooseProgram) {
      this.gooseUniforms = {
        spritesheet: gl.getUniformLocation(this.gooseProgram, 'u_spritesheet'),
        aspect: gl.getUniformLocation(this.gooseProgram, 'u_aspect'),
        spriteAspect: gl.getUniformLocation(this.gooseProgram, 'u_spriteAspect'),
        frameCount: gl.getUniformLocation(this.gooseProgram, 'u_frameCount')
      }

      this.gooseVao = gl.createVertexArray()!
      gl.bindVertexArray(this.gooseVao)

      // Static unit quad: position + UV (triangle strip)
      // prettier-ignore
      const quadData = new Float32Array([
        // pos.x  pos.y  uv.x  uv.y
        -1, +1,   0, 0,  // top-left
        +1, +1,   1, 0,  // top-right
        -1, -1,   0, 1,  // bottom-left
        +1, -1,   1, 1,  // bottom-right
      ])
      this.gooseQuadVbo = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, this.gooseQuadVbo)
      gl.bufferData(gl.ARRAY_BUFFER, quadData, gl.STATIC_DRAW)
      // a_quadPos (location 0)
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0)
      // a_quadUV (location 1)
      gl.enableVertexAttribArray(1)
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8)

      // Per-instance data buffer
      this.gooseInstanceVbo = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, this.gooseInstanceVbo)
      gl.bufferData(gl.ARRAY_BUFFER, this.gooseInstanceData.byteLength, gl.DYNAMIC_DRAW)
      const instStride = GOOSE_INSTANCE_FLOATS * 4 // 24 bytes
      // a_center (location 2) — vec2
      gl.enableVertexAttribArray(2)
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, instStride, 0)
      gl.vertexAttribDivisor(2, 1)
      // a_scale (location 3) — float
      gl.enableVertexAttribArray(3)
      gl.vertexAttribPointer(3, 1, gl.FLOAT, false, instStride, 8)
      gl.vertexAttribDivisor(3, 1)
      // a_rotation (location 4) — float
      gl.enableVertexAttribArray(4)
      gl.vertexAttribPointer(4, 1, gl.FLOAT, false, instStride, 12)
      gl.vertexAttribDivisor(4, 1)
      // a_frame (location 5) — float
      gl.enableVertexAttribArray(5)
      gl.vertexAttribPointer(5, 1, gl.FLOAT, false, instStride, 16)
      gl.vertexAttribDivisor(5, 1)
      // a_alpha (location 6) — float
      gl.enableVertexAttribArray(6)
      gl.vertexAttribPointer(6, 1, gl.FLOAT, false, instStride, 20)
      gl.vertexAttribDivisor(6, 1)
      // a_flipX (location 7) — float
      gl.enableVertexAttribArray(7)
      gl.vertexAttribPointer(7, 1, gl.FLOAT, false, instStride, 24)
      gl.vertexAttribDivisor(7, 1)
      // a_colorTint (location 8) — vec3
      gl.enableVertexAttribArray(8)
      gl.vertexAttribPointer(8, 3, gl.FLOAT, false, instStride, 28)
      gl.vertexAttribDivisor(8, 1)

      gl.bindVertexArray(null)
    }

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
    gl.disable(gl.DEPTH_TEST)
  }

  private buildProgram(vsSrc: string, fsSrc: string): WebGLProgram | null {
    const gl = this.gl!
    const vs = this.compileShader(gl.VERTEX_SHADER, vsSrc)
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSrc)
    if (!vs || !fs) return null

    const prog = gl.createProgram()!
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Vortex program link failed:', gl.getProgramInfoLog(prog))
      return null
    }
    return prog
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl!
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Vortex shader compile failed:', gl.getShaderInfoLog(shader))
      gl.deleteShader(shader)
      return null
    }
    return shader
  }

  private ensureBloomFbos(): void {
    const gl = this.gl!
    const ds = Math.max(1, Math.round(this.settings.bloomDownsample))
    const bw = Math.max(1, Math.floor(this.canvas.width / ds))
    const bh = Math.max(1, Math.floor(this.canvas.height / ds))
    if (bw === this.bloomW && bh === this.bloomH) return
    this.bloomW = bw
    this.bloomH = bh

    const makeFboTex = (w: number, h: number): [WebGLFramebuffer, WebGLTexture] => {
      const tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

      const fbo = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      return [fbo, tex]
    }

    if (this.sceneFbo) gl.deleteFramebuffer(this.sceneFbo)
    if (this.sceneTex) gl.deleteTexture(this.sceneTex)
    if (this.pingFbo) gl.deleteFramebuffer(this.pingFbo)
    if (this.pingTex) gl.deleteTexture(this.pingTex)
    if (this.pongFbo) gl.deleteFramebuffer(this.pongFbo)
    if (this.pongTex) gl.deleteTexture(this.pongTex)
    ;[this.sceneFbo, this.sceneTex] = makeFboTex(this.canvas.width, this.canvas.height)
    ;[this.pingFbo, this.pingTex] = makeFboTex(bw, bh)
    ;[this.pongFbo, this.pongTex] = makeFboTex(bw, bh)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindTexture(gl.TEXTURE_2D, null)
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width
    this.height = height
    this.canvas.width = Math.floor(width * dpr)
    this.canvas.height = Math.floor(height * dpr)
    if (this.gl) {
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height)
      this.bloomW = 0
      this.bloomH = 0
    }
  }

  setTargetCount(count: number): void {
    this._targetCount = Math.min(count, VORTEX_MAX_PARTICLES)
  }

  setViewWarp(scaleX: number, scaleY: number): void {
    const clampWarp = (v: number) => Math.max(0.1, Math.min(4, Number.isFinite(v) ? v : 1))
    this.viewWarpX = clampWarp(scaleX)
    this.viewWarpY = clampWarp(scaleY)
  }

  setSpeedMultiplier(multiplier: number): void {
    this.speedMultiplier = Math.max(0.1, Math.min(5, Number.isFinite(multiplier) ? multiplier : 1))
  }

  setErrorMode(error: boolean): void {
    this._errorMode = error
  }

  setGooseEnabled(enabled: boolean): void {
    this._gooseEnabled = enabled
  }

  setGooseCount(count: number): void {
    this._gooseCount = Math.min(count, GOOSE_MAX_COUNT)
  }

  loadGooseSpritesheet(image: HTMLImageElement): void {
    const gl = this.gl
    if (!gl) return

    if (this.gooseSpritesheetTex) gl.deleteTexture(this.gooseSpritesheetTex)
    this.gooseSpritesheetTex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.gooseSpritesheetTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D, null)
  }

  respawnAllGoose(): void {
    for (let i = 0; i < GOOSE_MAX_COUNT; i++) {
      randomGoose(this.gooseParticles, i * GOOSE_FLOATS_PER_PARTICLE, true, i, GOOSE_MAX_COUNT)
    }
  }

  respawnAllParticles(): void {
    for (let i = 0; i < this._activeCount; i++) {
      randomParticle(this.particles, i * FLOATS_PER_PARTICLE, false, this._errorMode)
    }
  }

  get activeCount(): number {
    return this._activeCount
  }

  render(dt: number): void {
    if (this.contextLost || !this.gl || !this.streakProgram) return

    const gl = this.gl
    const dtClamped = Math.min(dt, 0.05)

    if (this._activeCount < this._targetCount) {
      const toAdd = this._targetCount - this._activeCount
      for (let i = 0; i < toAdd; i++) {
        randomParticle(this.particles, (this._activeCount + i) * FLOATS_PER_PARTICLE, false, this._errorMode)
      }
      this._activeCount += toAdd
    }

    const aspect = this.width / Math.max(this.height, 1)

    let writeCount = this._activeCount
    for (let i = 0; i < writeCount; i++) {
      const off = i * FLOATS_PER_PARTICLE

      this.particles[off + P_Z] += this.particles[off + P_SPEED] * this.speedMultiplier * dtClamped

      if (this.particles[off + P_Z] > 1.0) {
        if (writeCount > this._targetCount) {
          writeCount--
          const lastOff = writeCount * FLOATS_PER_PARTICLE
          for (let j = 0; j < FLOATS_PER_PARTICLE; j++) {
            this.particles[off + j] = this.particles[lastOff + j]
          }
          i--
          continue
        } else {
          randomParticle(this.particles, off, true, this._errorMode)
        }
      }

      const angle = this.particles[off + P_ANGLE]
      const radius = this.particles[off + P_RADIUS]
      const z = this.particles[off + P_Z]
      const brightness = this.particles[off + P_BRIGHTNESS]
      const colorType = this.particles[off + P_COLOR_TYPE]
      const halfW = this.particles[off + P_WIDTH] * 0.5

      const perspHead = 1.0 / (1.0 + (1.0 - z) * VORTEX_PERSPECTIVE_DEPTH)
      const zTail = Math.max(0, z - VORTEX_STREAK_LENGTH)
      const perspTail = 1.0 / (1.0 + (1.0 - zTail) * VORTEX_PERSPECTIVE_DEPTH)

      const cosA = Math.cos(angle)
      const sinA = Math.sin(angle)

      const hx = (radius * cosA * perspHead) / aspect
      const hy = radius * sinA * perspHead
      const tx = (radius * cosA * perspTail) / aspect
      const ty = radius * sinA * perspTail

      const nx = (-sinA / aspect) * halfW * (0.5 + perspHead * 0.5)
      const ny = cosA * halfW * (0.5 + perspHead * 0.5)
      const ntx = (-sinA / aspect) * halfW * (0.5 + perspTail * 0.5)
      const nty = cosA * halfW * (0.5 + perspTail * 0.5)

      const fadeIn = smoothstep(0, VORTEX_FADE_IN_END, z)
      const fadeOut = smoothstep(1.0, 0.85, z)
      const bHead = brightness * (0.2 + z * 0.8) * fadeIn * fadeOut
      const bTail = bHead * VORTEX_TAIL_BRIGHTNESS

      const warpX = this.viewWarpX
      const warpY = this.viewWarpY

      const vOff = i * VERTS_PER_QUAD * FLOATS_PER_VERTEX
      this.quadVerts[vOff] = (tx - ntx) * warpX
      this.quadVerts[vOff + 1] = (ty - nty) * warpY
      this.quadVerts[vOff + 2] = bTail
      this.quadVerts[vOff + 3] = colorType
      this.quadVerts[vOff + 4] = (tx + ntx) * warpX
      this.quadVerts[vOff + 5] = (ty + nty) * warpY
      this.quadVerts[vOff + 6] = bTail
      this.quadVerts[vOff + 7] = colorType
      this.quadVerts[vOff + 8] = (hx - nx) * warpX
      this.quadVerts[vOff + 9] = (hy - ny) * warpY
      this.quadVerts[vOff + 10] = bHead
      this.quadVerts[vOff + 11] = colorType
      this.quadVerts[vOff + 12] = (hx + nx) * warpX
      this.quadVerts[vOff + 13] = (hy + ny) * warpY
      this.quadVerts[vOff + 14] = bHead
      this.quadVerts[vOff + 15] = colorType
    }
    this._activeCount = writeCount

    if (this._activeCount === 0) return

    const vertFloats = this._activeCount * VERTS_PER_QUAD * FLOATS_PER_VERTEX
    const indexCount = this._activeCount * INDICES_PER_QUAD

    gl.bindBuffer(gl.ARRAY_BUFFER, this.streakVbo)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.quadVerts, 0, vertFloats)

    const useBloom = this.settings.bloomEnabled && this.blurProgram && this.compositeProgram

    if (useBloom) {
      this.ensureBloomFbos()
    }

    const hasFbos = useBloom && this.sceneFbo && this.pingFbo && this.pongFbo

    // --- Render streaks ---
    if (hasFbos) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo)
      gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    }

    // Disable blending for the clear + first draw into FBO to avoid alpha issues
    gl.disable(gl.BLEND)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)

    // Re-enable additive blending for the streaks
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE)

    gl.useProgram(this.streakProgram)
    gl.uniform3fv(this.paletteLoc, PALETTE)
    gl.bindVertexArray(this.streakVao)
    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0)
    gl.bindVertexArray(null)

    if (!hasFbos) {
      // No bloom — render geese directly to screen after streaks
      if (this._gooseEnabled && this.gooseProgram && this.gooseSpritesheetTex && this.gooseVao) {
        this.renderGeese(gl, dtClamped, aspect)
      }
      return
    }

    // --- Blur passes ---
    gl.disable(gl.BLEND)
    gl.useProgram(this.blurProgram)
    gl.uniform1i(this.blurTexLoc, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindVertexArray(this.bloomQuadVao)

    gl.viewport(0, 0, this.bloomW, this.bloomH)
    const spread = this.settings.bloomBlurSpread
    const spreadX = spread / this.bloomW
    const spreadY = spread / this.bloomH

    // Iteration 1: scene → ping (H) → pong (V)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pingFbo)
    gl.uniform2f(this.blurDirLoc, spreadX, 0)
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pongFbo)
    gl.uniform2f(this.blurDirLoc, 0, spreadY)
    gl.bindTexture(gl.TEXTURE_2D, this.pingTex)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    // Iteration 2: pong → ping (H) → pong (V)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pingFbo)
    gl.uniform2f(this.blurDirLoc, spreadX, 0)
    gl.bindTexture(gl.TEXTURE_2D, this.pongTex)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pongFbo)
    gl.uniform2f(this.blurDirLoc, 0, spreadY)
    gl.bindTexture(gl.TEXTURE_2D, this.pingTex)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    // --- Composite to screen ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.useProgram(this.compositeProgram)
    gl.uniform1i(this.compositeBloomLoc, 0)

    // Draw scene (replace)
    gl.uniform1f(this.compositeIntensityLoc, 1.0)
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    // Additive bloom
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.uniform1f(this.compositeIntensityLoc, this.settings.bloomIntensity)
    gl.bindTexture(gl.TEXTURE_2D, this.pongTex)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    gl.bindVertexArray(null)

    // --- Render goose sprites after bloom (so they don't get bloomed) ---
    if (this._gooseEnabled && this.gooseProgram && this.gooseSpritesheetTex && this.gooseVao) {
      this.renderGeese(gl, dtClamped, aspect)
    }

    // Restore default blend state
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
  }

  private renderGeese(gl: WebGL2RenderingContext, dt: number, aspect: number): void {
    const spriteAspect = 163 / 101

    const warpX = this.viewWarpX
    const warpY = this.viewWarpY
    const count = this._gooseCount

    // Update particles and build sort index (far first for painter's order)
    const sortIndices: number[] = []
    for (let i = 0; i < count; i++) {
      const off = i * GOOSE_FLOATS_PER_PARTICLE
      this.gooseParticles[off + G_Z] += this.gooseParticles[off + G_SPEED] * this.speedMultiplier * dt
      // Accumulate animation time — speeds up mildly with depth (1x at z=0, 1.5x at z=1)
      const z = this.gooseParticles[off + G_Z]
      this.gooseParticles[off + G_ANIM_TIME] += GOOSE_FPS * (1.0 + z * 0.5) * dt
      if (z > 1.0) {
        randomGoose(this.gooseParticles, off, false, -1, count)
      }
      sortIndices.push(i)
    }
    sortIndices.sort(
      (a, b) =>
        this.gooseParticles[a * GOOSE_FLOATS_PER_PARTICLE + G_Z] -
        this.gooseParticles[b * GOOSE_FLOATS_PER_PARTICLE + G_Z]
    )

    // Build per-instance data
    for (let si = 0; si < count; si++) {
      const i = sortIndices[si]
      const off = i * GOOSE_FLOATS_PER_PARTICLE
      const angle = this.gooseParticles[off + G_ANGLE]
      const radius = this.gooseParticles[off + G_RADIUS]
      const z = this.gooseParticles[off + G_Z]

      const persp = 1.0 / (1.0 + (1.0 - z) * VORTEX_PERSPECTIVE_DEPTH)
      const sizeMult = this.gooseParticles[off + G_SIZE_MULT]
      const scale = (GOOSE_MIN_SCALE + (GOOSE_MAX_SCALE - GOOSE_MIN_SCALE) * persp) * sizeMult

      // Center position in clip space — fly straight out from center along fixed angle
      const cx = ((radius * Math.cos(angle) * persp) / aspect) * warpX
      const cy = radius * Math.sin(angle) * persp * warpY

      // Rotation: tilt toward the radial outward direction.
      // If the tilt would flip the goose upside down, negate it and flip the sprite instead.
      const radialX = Math.cos(angle) * warpX
      const radialY = Math.sin(angle) * warpY
      const radialAngle = Math.atan2(radialY, radialX)
      let tilt = radialAngle - Math.PI / 2 + this.gooseParticles[off + G_TILT]
      // Normalize to [-π, π]
      tilt = ((((tilt + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI
      let flipX = 0.0
      if (tilt > Math.PI / 2) {
        tilt = Math.PI - tilt
        flipX = 1.0
      } else if (tilt < -Math.PI / 2) {
        tilt = -Math.PI - tilt
        flipX = 1.0
      }

      // Fade in/out
      const fadeIn = smoothstep(0, GOOSE_FADE_IN_END, z)
      const fadeOut = smoothstep(1.0, GOOSE_FADE_OUT_START, z)

      const frame = Math.floor(this.gooseParticles[off + G_ANIM_TIME]) % GOOSE_FRAME_COUNT

      const iOff = si * GOOSE_INSTANCE_FLOATS
      this.gooseInstanceData[iOff] = cx
      this.gooseInstanceData[iOff + 1] = cy
      this.gooseInstanceData[iOff + 2] = scale
      this.gooseInstanceData[iOff + 3] = tilt
      this.gooseInstanceData[iOff + 4] = frame
      this.gooseInstanceData[iOff + 5] = fadeIn * fadeOut
      this.gooseInstanceData[iOff + 6] = flipX

      // Color tint from hue shift + brightness
      const hue = this.gooseParticles[off + G_HUE_SHIFT]
      const bright = this.gooseParticles[off + G_BRIGHTNESS]
      // Approximate hue rotation as RGB multiplier: shift toward warm or cool
      const cosH = Math.cos(hue)
      const sinH = Math.sin(hue)
      this.gooseInstanceData[iOff + 7] = bright * (0.7 + 0.3 * cosH + 0.15 * sinH) // R
      this.gooseInstanceData[iOff + 8] = bright * (0.7 + 0.3 * cosH - 0.08 * sinH) // G
      this.gooseInstanceData[iOff + 9] = bright * (0.7 + 0.3 * cosH - 0.2 * sinH) // B
    }

    // Switch to standard alpha blending for sprites
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    gl.useProgram(this.gooseProgram)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.gooseSpritesheetTex)
    gl.uniform1i(this.gooseUniforms.spritesheet, 0)
    gl.uniform1f(this.gooseUniforms.aspect, aspect)
    gl.uniform1f(this.gooseUniforms.spriteAspect, spriteAspect)
    gl.uniform1f(this.gooseUniforms.frameCount, GOOSE_FRAME_COUNT)

    gl.bindVertexArray(this.gooseVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gooseInstanceVbo)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.gooseInstanceData, 0, count * GOOSE_INSTANCE_FLOATS)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)
    gl.bindVertexArray(null)

    // Restore additive blending
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost)
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored)

    if (this.gl) {
      const gl = this.gl
      if (this.streakVbo) gl.deleteBuffer(this.streakVbo)
      if (this.streakIbo) gl.deleteBuffer(this.streakIbo)
      if (this.streakVao) gl.deleteVertexArray(this.streakVao)
      if (this.streakProgram) gl.deleteProgram(this.streakProgram)
      if (this.bloomQuadVbo) gl.deleteBuffer(this.bloomQuadVbo)
      if (this.bloomQuadVao) gl.deleteVertexArray(this.bloomQuadVao)
      if (this.blurProgram) gl.deleteProgram(this.blurProgram)
      if (this.compositeProgram) gl.deleteProgram(this.compositeProgram)
      if (this.gooseQuadVbo) gl.deleteBuffer(this.gooseQuadVbo)
      if (this.gooseInstanceVbo) gl.deleteBuffer(this.gooseInstanceVbo)
      if (this.gooseVao) gl.deleteVertexArray(this.gooseVao)
      if (this.gooseProgram) gl.deleteProgram(this.gooseProgram)
      if (this.gooseSpritesheetTex) gl.deleteTexture(this.gooseSpritesheetTex)
      if (this.sceneFbo) gl.deleteFramebuffer(this.sceneFbo)
      if (this.sceneTex) gl.deleteTexture(this.sceneTex)
      if (this.pingFbo) gl.deleteFramebuffer(this.pingFbo)
      if (this.pingTex) gl.deleteTexture(this.pingTex)
      if (this.pongFbo) gl.deleteFramebuffer(this.pongFbo)
      if (this.pongTex) gl.deleteTexture(this.pongTex)
    }

    this.gl = null
    this.streakProgram = null
    this.streakVao = null
    this.streakVbo = null
    this.streakIbo = null
    this.blurProgram = null
    this.compositeProgram = null
    this.bloomQuadVao = null
    this.bloomQuadVbo = null
    this.sceneFbo = null
    this.sceneTex = null
    this.pingFbo = null
    this.pingTex = null
    this.pongFbo = null
    this.pongTex = null
    this.gooseProgram = null
    this.gooseVao = null
    this.gooseQuadVbo = null
    this.gooseInstanceVbo = null
    this.gooseSpritesheetTex = null
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}
