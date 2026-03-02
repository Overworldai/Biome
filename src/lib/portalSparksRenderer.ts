/**
 * Portal Sparks Renderer — WebGL2 particle effect for the portal edge
 *
 * Renders Doctor Strange-style sparks that emit from the portal's edge and
 * fly outward. The portal shape is sampled via edge detection on an offscreen
 * rasterisation of the actual CSS border-radius + rotation, so alignment is
 * pixel-perfect regardless of CSS changes.
 *
 * Architecture mirrors vortexRenderer.ts: CPU particle pool, single draw call
 * of additive-blended streak quads.
 */

// --- Tuning constants ---
const MAX_PARTICLES = 400
const SPAWN_RATE = 180 // particles per second at intensity 1.0
const LIFETIME_MIN = 0.35
const LIFETIME_MAX = 0.9
const TANGENT_SPEED_MIN = 80 // CSS px/s — along the ring (primary)
const TANGENT_SPEED_MAX = 180
const RADIAL_SPEED_MIN = 15 // CSS px/s — gentle outward drift
const RADIAL_SPEED_MAX = 45
// Elliptical gravity: pulls particles back toward the ring.
// Tuned so tangentSpeed ≈ omega * radius gives near-circular orbits
// that gradually spiral out due to the radial kick.
const GRAVITY_STRENGTH = 2.5 // ω² for the harmonic oscillator
const SIZE_MIN = 3.0 // px (before DPR)
const SIZE_MAX = 7.0
const STREAK_ASPECT = 3.0
const BRIGHTNESS_MIN = 0.7
const BRIGHTNESS_MAX = 1.0
const HOT_SPARK_CHANCE = 0.12
const HOT_SPARK_MULT = 1.8
const FADE_OUT_START = 0.65

// Edge map sampling resolution (width; height derived from aspect)
const EDGE_SAMPLE_W = 128

// Core border-radius from CSS: `43% 54% 46% 57% / 48% 55% 45% 52%`
// Order: top-left, top-right, bottom-right, bottom-left
const BORDER_RADII_X = [0.43, 0.54, 0.46, 0.57]
const BORDER_RADII_Y = [0.48, 0.55, 0.45, 0.52]
const CORE_TILT_DEG = -8

// CPU particle fields — position/velocity in canvas CSS px
const P_X = 0
const P_Y = 1
const P_VX = 2
const P_VY = 3
const P_AGE = 4
const P_LIFETIME = 5
const P_BRIGHTNESS = 6
const P_SIZE = 7
const FLOATS_PER_PARTICLE = 8

const FLOATS_PER_VERTEX = 5 // x, y, u, v, brightness
const VERTS_PER_QUAD = 4
const INDICES_PER_QUAD = 6

// --- Shaders ---
const SPARK_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in float a_brightness;

out vec2 v_uv;
out float v_brightness;

void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = a_uv;
  v_brightness = a_brightness;
}
`

const SPARK_FS = `#version 300 es
precision highp float;

in vec2 v_uv;
in float v_brightness;

uniform vec3 u_glowColor;

out vec4 fragColor;

void main() {
  float dx = v_uv.x * 0.6;
  float dy = v_uv.y;
  float d = length(vec2(dx, dy));
  float alpha = 1.0 - smoothstep(0.0, 1.0, d);
  alpha *= alpha;

  float coreMix = smoothstep(0.4, 0.0, d);
  vec3 color = mix(u_glowColor, vec3(1.0), coreMix);

  // Output premultiplied RGB with zero alpha. With premultipliedAlpha: true,
  // the browser composites as: result = canvas.rgb + page.rgb * (1 - 0),
  // giving pure additive blending with no dark halo.
  float a = alpha * v_brightness;
  fragColor = vec4(color * a, 0.0);
}
`

/**
 * Build an edge map by rasterising the portal core shape onto an offscreen
 * canvas and detecting boundary pixels.
 *
 * Returns Float32Array of [localX, localY, nx, ny, ...] relative to core center,
 * plus the count of edge points.
 */
function buildEdgeMap(coreW: number, coreH: number): { points: Float32Array; count: number } {
  // Add padding so the -8deg rotation doesn't clip corners
  const PAD_FRAC = 0.15
  const paddedW = coreW * (1 + 2 * PAD_FRAC)
  const paddedH = coreH * (1 + 2 * PAD_FRAC)

  const scale = EDGE_SAMPLE_W / paddedW
  const sampleW = EDGE_SAMPLE_W
  const sampleH = Math.round(paddedH * scale)

  // The core rect within the padded canvas
  const coreX = Math.round(paddedW * PAD_FRAC * scale)
  const coreY = Math.round(paddedH * PAD_FRAC * scale)
  const coreSW = Math.round(coreW * scale)
  const coreSH = Math.round(coreH * scale)

  const offscreen = document.createElement('canvas')
  offscreen.width = sampleW
  offscreen.height = sampleH
  const ctx = offscreen.getContext('2d')!

  // Rotate around the center of the core (not the padded canvas)
  const coreCenterX = coreX + coreSW / 2
  const coreCenterY = coreY + coreSH / 2
  ctx.translate(coreCenterX, coreCenterY)
  ctx.rotate((CORE_TILT_DEG * Math.PI) / 180)
  ctx.translate(-coreCenterX, -coreCenterY)

  // Draw rounded rect at the core position within padded canvas
  ctx.beginPath()
  ctx.roundRect(
    coreX,
    coreY,
    coreSW,
    coreSH,
    BORDER_RADII_X.map((rx, i) => ({
      x: coreSW * rx,
      y: coreSH * BORDER_RADII_Y[i]
    }))
  )
  ctx.fillStyle = 'white'
  ctx.fill()

  // Read pixels and detect edges
  const imageData = ctx.getImageData(0, 0, sampleW, sampleH)
  const px = imageData.data
  const edges: number[] = []

  for (let y = 1; y < sampleH - 1; y++) {
    for (let x = 1; x < sampleW - 1; x++) {
      const a = px[(y * sampleW + x) * 4 + 3]
      if (a < 128) continue

      const top = px[((y - 1) * sampleW + x) * 4 + 3] < 128
      const bot = px[((y + 1) * sampleW + x) * 4 + 3] < 128
      const left = px[(y * sampleW + (x - 1)) * 4 + 3] < 128
      const right = px[(y * sampleW + (x + 1)) * 4 + 3] < 128

      if (!top && !bot && !left && !right) continue

      let nx = 0,
        ny = 0
      if (left) nx -= 1
      if (right) nx += 1
      if (top) ny -= 1
      if (bot) ny += 1
      const len = Math.sqrt(nx * nx + ny * ny)
      if (len > 0) {
        nx /= len
        ny /= len
      }

      // Map to local coords relative to core center
      const localX = (x - coreCenterX) / scale
      const localY = (y - coreCenterY) / scale

      edges.push(localX, localY, nx, ny)
    }
  }

  return { points: new Float32Array(edges), count: edges.length / 4 }
}

function spawnParticle(out: Float32Array, offset: number, edgePoints: Float32Array, edgeCount: number): void {
  // Pick a random edge point
  const ei = Math.floor(Math.random() * edgeCount) * 4
  out[offset + P_X] = edgePoints[ei]
  out[offset + P_Y] = edgePoints[ei + 1]
  const nx = edgePoints[ei + 2]
  const ny = edgePoints[ei + 3]

  // Tangent is perpendicular to normal (along the ring)
  const tx = -ny
  const ty = nx

  // Velocity: primarily tangential (sweeping along the ring),
  // with gentle radial outward drift — creates spiral-out effect
  const tangentSpeed = TANGENT_SPEED_MIN + Math.random() * (TANGENT_SPEED_MAX - TANGENT_SPEED_MIN)
  const radialSpeed = RADIAL_SPEED_MIN + Math.random() * (RADIAL_SPEED_MAX - RADIAL_SPEED_MIN)
  // All particles travel the same direction (CW)
  out[offset + P_VX] = tx * tangentSpeed + nx * radialSpeed
  out[offset + P_VY] = ty * tangentSpeed + ny * radialSpeed

  out[offset + P_AGE] = 0
  out[offset + P_LIFETIME] = LIFETIME_MIN + Math.random() * (LIFETIME_MAX - LIFETIME_MIN)
  const baseBrightness = BRIGHTNESS_MIN + Math.random() * (BRIGHTNESS_MAX - BRIGHTNESS_MIN)
  out[offset + P_BRIGHTNESS] = Math.random() < HOT_SPARK_CHANCE ? baseBrightness * HOT_SPARK_MULT : baseBrightness
  out[offset + P_SIZE] = SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN)
}

export class PortalSparksRenderer {
  private gl: WebGL2RenderingContext | null = null
  private program: WebGLProgram | null = null
  private vao: WebGLVertexArrayObject | null = null
  private vbo: WebGLBuffer | null = null
  private ibo: WebGLBuffer | null = null
  private glowColorLoc: WebGLUniformLocation | null = null

  private particles: Float32Array
  private quadVerts: Float32Array
  private indices: Uint32Array
  private activeCount = 0
  private spawnAccum = 0

  private canvasW = 0
  private canvasH = 0
  private dpr = 1
  private glowR = 0.55
  private glowG = 0.81
  private glowB = 0.96
  private intensity = 1.0
  private contextLost = false

  // Edge map: points stored in local coords (relative to core center)
  // Each point: [localX, localY, normalX, normalY]
  private edgeLocal: Float32Array = new Float32Array(0)
  // Edge map translated to current canvas coords (rebuilt when center moves)
  private edgePoints: Float32Array = new Float32Array(0)
  private edgeCount = 0
  private edgeCx = 0
  private edgeCy = 0

  // Ellipse parameters for gravity (set from core measurements)
  private ellipseA = 1 // semi-axis X (un-rotated)
  private ellipseB = 1 // semi-axis Y (un-rotated)
  private tiltRad = (-8 * Math.PI) / 180
  private cosTilt = Math.cos((-8 * Math.PI) / 180)
  private sinTilt = Math.sin((-8 * Math.PI) / 180)

  /** Set to true to render edge points as red dots for debugging alignment */
  debug = false

  private handleContextLost: (e: Event) => void
  private handleContextRestored: () => void

  constructor(private canvas: HTMLCanvasElement) {
    this.particles = new Float32Array(MAX_PARTICLES * FLOATS_PER_PARTICLE)
    this.quadVerts = new Float32Array(MAX_PARTICLES * VERTS_PER_QUAD * FLOATS_PER_VERTEX)

    this.indices = new Uint32Array(MAX_PARTICLES * INDICES_PER_QUAD)
    for (let i = 0; i < MAX_PARTICLES; i++) {
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
      premultipliedAlpha: true,
      antialias: false,
      powerPreference: 'default'
    })
    if (!gl) return

    this.gl = gl

    const vs = this.compileShader(gl.VERTEX_SHADER, SPARK_VS)
    const fs = this.compileShader(gl.FRAGMENT_SHADER, SPARK_FS)
    if (!vs || !fs) return

    const prog = gl.createProgram()!
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('PortalSparks program link failed:', gl.getProgramInfoLog(prog))
      return
    }
    this.program = prog
    this.glowColorLoc = gl.getUniformLocation(prog, 'u_glowColor')

    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)

    this.vbo = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.bufferData(gl.ARRAY_BUFFER, this.quadVerts.byteLength, gl.DYNAMIC_DRAW)

    const stride = FLOATS_PER_VERTEX * 4
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 16)

    this.ibo = gl.createBuffer()!
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indices, gl.STATIC_DRAW)
    gl.bindVertexArray(null)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE) // pure additive (alpha already baked into RGB)
    gl.disable(gl.DEPTH_TEST)
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl!
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('PortalSparks shader compile failed:', gl.getShaderInfoLog(shader))
      gl.deleteShader(shader)
      return null
    }
    return shader
  }

  resizeCanvas(cssW: number, cssH: number, dpr: number): void {
    // Always update logical dimensions (used for clip-space conversion),
    // but only resize the backing store when pixel dimensions change.
    this.canvasW = cssW
    this.canvasH = cssH
    this.dpr = dpr
    const pw = Math.floor(cssW * dpr)
    const ph = Math.floor(cssH * dpr)
    if (this.canvas.width === pw && this.canvas.height === ph) return
    this.canvas.width = pw
    this.canvas.height = ph
    if (this.gl) {
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    }
  }

  /**
   * Rebuild the edge map from the core element's measured geometry.
   * Called on resize (shape changes). Stores points in local coords.
   */
  updateEdgeMap(coreW: number, coreH: number, coreCx: number, coreCy: number): void {
    if (coreW < 1 || coreH < 1) return
    const result = buildEdgeMap(coreW, coreH)
    this.edgeLocal = result.points
    this.edgeCount = result.count
    // Store ellipse semi-axes for gravity
    this.ellipseA = coreW / 2
    this.ellipseB = coreH / 2
    // Build canvas-space points at current center
    this.applyCenter(coreCx, coreCy)
  }

  /**
   * Scale all active particles to match a change in core size.
   * Displacement from center is scaled proportionally so particles
   * contract/expand with the portal.
   */
  scaleParticles(scaleX: number, scaleY: number): void {
    for (let i = 0; i < this.activeCount; i++) {
      const off = i * FLOATS_PER_PARTICLE
      const dx = this.particles[off + P_X] - this.edgeCx
      const dy = this.particles[off + P_Y] - this.edgeCy
      this.particles[off + P_X] = this.edgeCx + dx * scaleX
      this.particles[off + P_Y] = this.edgeCy + dy * scaleY
      this.particles[off + P_VX] *= scaleX
      this.particles[off + P_VY] *= scaleY
    }
  }

  /**
   * Update the edge map center without re-doing edge detection.
   * Called each frame to track portal bobbing/translation.
   */
  updateEdgeCenter(cx: number, cy: number): void {
    if (this.edgeCount === 0) return
    // Only rebuild if center actually moved
    if (Math.abs(cx - this.edgeCx) < 0.5 && Math.abs(cy - this.edgeCy) < 0.5) return
    this.applyCenter(cx, cy)
  }

  private applyCenter(cx: number, cy: number): void {
    this.edgeCx = cx
    this.edgeCy = cy
    // Translate local edge points to canvas-space
    const n = this.edgeCount * 4
    if (this.edgePoints.length !== n) {
      this.edgePoints = new Float32Array(n)
    }
    for (let i = 0; i < n; i += 4) {
      this.edgePoints[i] = this.edgeLocal[i] + cx // x
      this.edgePoints[i + 1] = this.edgeLocal[i + 1] + cy // y
      this.edgePoints[i + 2] = this.edgeLocal[i + 2] // nx
      this.edgePoints[i + 3] = this.edgeLocal[i + 3] // ny
    }
  }

  setGlowColor(r: number, g: number, b: number): void {
    this.glowR = r / 255
    this.glowG = g / 255
    this.glowB = b / 255
  }

  setIntensity(multiplier: number): void {
    this.intensity = Math.max(0, Math.min(3, multiplier))
  }

  render(dt: number): void {
    if (this.contextLost || !this.gl || !this.program || this.edgeCount === 0) return

    const gl = this.gl
    const dtClamped = Math.min(dt, 0.05)

    // --- Spawn ---
    this.spawnAccum += SPAWN_RATE * this.intensity * dtClamped
    while (this.spawnAccum >= 1 && this.activeCount < MAX_PARTICLES) {
      spawnParticle(this.particles, this.activeCount * FLOATS_PER_PARTICLE, this.edgePoints, this.edgeCount)
      this.activeCount++
      this.spawnAccum -= 1
    }
    if (this.spawnAccum >= 1) this.spawnAccum = 0

    // --- Update + build quads ---
    let writeIdx = 0
    for (let i = 0; i < this.activeCount; i++) {
      const off = i * FLOATS_PER_PARTICLE

      this.particles[off + P_AGE] += dtClamped
      const age = this.particles[off + P_AGE]
      const lifetime = this.particles[off + P_LIFETIME]

      if (age >= lifetime) {
        this.activeCount--
        const lastOff = this.activeCount * FLOATS_PER_PARTICLE
        for (let j = 0; j < FLOATS_PER_PARTICLE; j++) {
          this.particles[off + j] = this.particles[lastOff + j]
        }
        i--
        continue
      }

      // --- Elliptical gravity + surface repulsion ---
      // Transform displacement to ellipse-local coords (un-rotated)
      const dx = this.particles[off + P_X] - this.edgeCx
      const dy = this.particles[off + P_Y] - this.edgeCy
      const lx = dx * this.cosTilt + dy * this.sinTilt
      const ly = -dx * this.sinTilt + dy * this.cosTilt

      // Normalized ellipse distance: d=1 on the surface, <1 inside, >1 outside
      const nlx = lx / this.ellipseA
      const nly = ly / this.ellipseB
      const d = Math.sqrt(nlx * nlx + nly * nly)

      // Gravity: attractive (toward center) when outside, repulsive when inside
      // This keeps particles orbiting near the surface without falling through
      let gravityMul: number
      if (d > 1.0) {
        // Outside: normal attractive gravity
        gravityMul = -GRAVITY_STRENGTH
      } else {
        // Inside: repulsive push outward (stronger the deeper inside)
        gravityMul = GRAVITY_STRENGTH * 3.0
      }

      const gxLocal = gravityMul * lx
      const gyLocal = gravityMul * ly

      // Transform acceleration back to screen space
      const ax = gxLocal * this.cosTilt - gyLocal * this.sinTilt
      const ay = gxLocal * this.sinTilt + gyLocal * this.cosTilt

      // Apply acceleration to velocity
      this.particles[off + P_VX] += ax * dtClamped
      this.particles[off + P_VY] += ay * dtClamped

      // Move
      this.particles[off + P_X] += this.particles[off + P_VX] * dtClamped
      this.particles[off + P_Y] += this.particles[off + P_VY] * dtClamped

      const px = this.particles[off + P_X]
      const py = this.particles[off + P_Y]
      const vx = this.particles[off + P_VX]
      const vy = this.particles[off + P_VY]
      const brightness = this.particles[off + P_BRIGHTNESS]
      const size = this.particles[off + P_SIZE] * this.dpr

      // Fade
      const lifeFrac = age / lifetime
      const fadeIn = Math.min(1, lifeFrac / 0.1)
      const fadeOut = lifeFrac > FADE_OUT_START ? 1 - (lifeFrac - FADE_OUT_START) / (1 - FADE_OUT_START) : 1
      const alpha = brightness * fadeIn * fadeOut * this.intensity

      // Streak direction from velocity
      const velLen = Math.sqrt(vx * vx + vy * vy)
      let dirX: number, dirY: number
      if (velLen > 0.01) {
        dirX = vx / velLen
        dirY = vy / velLen
      } else {
        dirX = 1
        dirY = 0
      }
      const perpX = -dirY
      const perpY = dirX

      // Convert to clip space
      const clipX = (px / this.canvasW) * 2 - 1
      const clipY = 1 - (py / this.canvasH) * 2

      // Streak half-extents
      const halfLong = (size * STREAK_ASPECT * 0.5) / this.canvas.width
      const halfShort = (size * 0.5) / this.canvas.height
      const cdx = dirX * halfLong * 2
      const cdy = -dirY * halfLong * 2
      const cpx = perpX * halfShort * 2
      const cpy = -perpY * halfShort * 2

      const vOff = writeIdx * VERTS_PER_QUAD * FLOATS_PER_VERTEX

      this.quadVerts[vOff] = clipX + cdx - cpx
      this.quadVerts[vOff + 1] = clipY + cdy - cpy
      this.quadVerts[vOff + 2] = -1
      this.quadVerts[vOff + 3] = -1
      this.quadVerts[vOff + 4] = alpha

      this.quadVerts[vOff + 5] = clipX + cdx + cpx
      this.quadVerts[vOff + 6] = clipY + cdy + cpy
      this.quadVerts[vOff + 7] = 1
      this.quadVerts[vOff + 8] = -1
      this.quadVerts[vOff + 9] = alpha

      this.quadVerts[vOff + 10] = clipX - cdx - cpx
      this.quadVerts[vOff + 11] = clipY - cdy - cpy
      this.quadVerts[vOff + 12] = -1
      this.quadVerts[vOff + 13] = 1
      this.quadVerts[vOff + 14] = alpha

      this.quadVerts[vOff + 15] = clipX - cdx + cpx
      this.quadVerts[vOff + 16] = clipY - cdy + cpy
      this.quadVerts[vOff + 17] = 1
      this.quadVerts[vOff + 18] = 1
      this.quadVerts[vOff + 19] = alpha

      writeIdx++
    }

    if (writeIdx === 0) {
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      return
    }

    const vertFloats = writeIdx * VERTS_PER_QUAD * FLOATS_PER_VERTEX
    const indexCount = writeIdx * INDICES_PER_QUAD

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.quadVerts, 0, vertFloats)

    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    gl.useProgram(this.program)
    gl.uniform3f(this.glowColorLoc, this.glowR, this.glowG, this.glowB)

    gl.bindVertexArray(this.vao)
    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0)
    gl.bindVertexArray(null)

    // --- Debug: draw edge points as bright dots ---
    if (this.debug && this.edgeCount > 0) {
      this.renderDebugEdge(gl)
    }
  }

  private renderDebugEdge(gl: WebGL2RenderingContext): void {
    // Render every Nth edge point as a small quad (subsample to keep it fast)
    const step = Math.max(1, Math.floor(this.edgeCount / 500))
    let debugIdx = 0
    const dotSize = 2 * this.dpr

    for (let i = 0; i < this.edgeCount && debugIdx < MAX_PARTICLES; i += step) {
      const ei = i * 4
      const px = this.edgePoints[ei]
      const py = this.edgePoints[ei + 1]

      const clipX = (px / this.canvasW) * 2 - 1
      const clipY = 1 - (py / this.canvasH) * 2
      const halfW = dotSize / this.canvas.width
      const halfH = dotSize / this.canvas.height

      const vOff = debugIdx * VERTS_PER_QUAD * FLOATS_PER_VERTEX

      // TL
      this.quadVerts[vOff] = clipX - halfW
      this.quadVerts[vOff + 1] = clipY + halfH
      this.quadVerts[vOff + 2] = 0
      this.quadVerts[vOff + 3] = 0
      this.quadVerts[vOff + 4] = 1.0

      // TR
      this.quadVerts[vOff + 5] = clipX + halfW
      this.quadVerts[vOff + 6] = clipY + halfH
      this.quadVerts[vOff + 7] = 0
      this.quadVerts[vOff + 8] = 0
      this.quadVerts[vOff + 9] = 1.0

      // BL
      this.quadVerts[vOff + 10] = clipX - halfW
      this.quadVerts[vOff + 11] = clipY - halfH
      this.quadVerts[vOff + 12] = 0
      this.quadVerts[vOff + 13] = 0
      this.quadVerts[vOff + 14] = 1.0

      // BR
      this.quadVerts[vOff + 15] = clipX + halfW
      this.quadVerts[vOff + 16] = clipY - halfH
      this.quadVerts[vOff + 17] = 0
      this.quadVerts[vOff + 18] = 0
      this.quadVerts[vOff + 19] = 1.0

      debugIdx++
    }

    if (debugIdx === 0) return

    const vertFloats = debugIdx * VERTS_PER_QUAD * FLOATS_PER_VERTEX
    const idxCount = debugIdx * INDICES_PER_QUAD

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.quadVerts, 0, vertFloats)

    gl.useProgram(this.program)
    // Use bright red for debug dots
    gl.uniform3f(this.glowColorLoc, 1.0, 0.2, 0.2)

    gl.bindVertexArray(this.vao)
    gl.drawElements(gl.TRIANGLES, idxCount, gl.UNSIGNED_INT, 0)
    gl.bindVertexArray(null)
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost)
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored)

    if (this.gl) {
      const gl = this.gl
      if (this.vbo) gl.deleteBuffer(this.vbo)
      if (this.ibo) gl.deleteBuffer(this.ibo)
      if (this.vao) gl.deleteVertexArray(this.vao)
      if (this.program) gl.deleteProgram(this.program)
    }

    this.gl = null
    this.program = null
    this.vao = null
    this.vbo = null
    this.ibo = null
  }
}
