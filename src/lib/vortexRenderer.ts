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

out vec4 fragColor;

void main() {
  vec3 color;
  float ct = v_colorType;
  if (ct < 0.5) {
    color = vec3(0.08, 0.15, 0.95);
  } else if (ct < 1.5) {
    color = vec3(0.2, 0.4, 1.0);
  } else if (ct < 2.5) {
    color = vec3(0.1, 0.55, 1.0);
  } else {
    color = vec3(0.55, 0.75, 1.0);
  }

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
function randomParticle(out: Float32Array, offset: number, resetZ: boolean): void {
  out[offset + P_ANGLE] = Math.random() * Math.PI * 2
  out[offset + P_RADIUS] = VORTEX_RADIUS_MIN + Math.random() * (VORTEX_RADIUS_MAX - VORTEX_RADIUS_MIN)
  out[offset + P_Z] = resetZ ? Math.random() * 0.05 : Math.random()
  out[offset + P_SPEED] = VORTEX_SPEED_MIN + Math.random() * (VORTEX_SPEED_MAX - VORTEX_SPEED_MIN)

  const isHot = Math.random() < VORTEX_HOT_STREAK_CHANCE
  const baseBrightness = VORTEX_BRIGHTNESS_MIN + Math.random() * (VORTEX_BRIGHTNESS_MAX - VORTEX_BRIGHTNESS_MIN)
  out[offset + P_BRIGHTNESS] = isHot ? baseBrightness * VORTEX_HOT_STREAK_BRIGHTNESS : baseBrightness

  out[offset + P_WIDTH] = VORTEX_WIDTH_MIN + Math.random() * (VORTEX_WIDTH_MAX - VORTEX_WIDTH_MIN)

  const roll = Math.random()
  out[offset + P_COLOR_TYPE] = roll < 0.4 ? 0 : roll < 0.65 ? 1 : roll < 0.85 ? 2 : 3
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
        randomParticle(this.particles, (this._activeCount + i) * FLOATS_PER_PARTICLE, false)
      }
      this._activeCount += toAdd
    }

    const aspect = this.width / Math.max(this.height, 1)

    let writeCount = this._activeCount
    for (let i = 0; i < writeCount; i++) {
      const off = i * FLOATS_PER_PARTICLE

      this.particles[off + P_Z] += this.particles[off + P_SPEED] * dtClamped

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
          randomParticle(this.particles, off, true)
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

      const vOff = i * VERTS_PER_QUAD * FLOATS_PER_VERTEX
      this.quadVerts[vOff] = tx - ntx
      this.quadVerts[vOff + 1] = ty - nty
      this.quadVerts[vOff + 2] = bTail
      this.quadVerts[vOff + 3] = colorType
      this.quadVerts[vOff + 4] = tx + ntx
      this.quadVerts[vOff + 5] = ty + nty
      this.quadVerts[vOff + 6] = bTail
      this.quadVerts[vOff + 7] = colorType
      this.quadVerts[vOff + 8] = hx - nx
      this.quadVerts[vOff + 9] = hy - ny
      this.quadVerts[vOff + 10] = bHead
      this.quadVerts[vOff + 11] = colorType
      this.quadVerts[vOff + 12] = hx + nx
      this.quadVerts[vOff + 13] = hy + ny
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
    gl.bindVertexArray(this.streakVao)
    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0)
    gl.bindVertexArray(null)

    if (!hasFbos) return

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
    // Restore default blend state
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
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}
