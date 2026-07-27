/* =========================================================================
   LONGSHOT — tiny WebGL2 engine
   Math, shaders, mesh building and the forward renderer. No dependencies.
   ========================================================================= */
(function (global) {
  'use strict';

  /* ----------------------------- math ---------------------------------- */

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  // frame-rate independent exponential smoothing
  const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

  function m4() { return new Float32Array(16); }

  function m4identity(o) {
    o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0;
    o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
    return o;
  }

  function m4mul(o, a, b) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    for (let i = 0; i < 4; i++) {
      const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
      o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    }
    return o;
  }

  function m4perspective(o, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    o.fill(0);
    o[0] = f / aspect;
    o[5] = f;
    o[11] = -1;
    o[10] = (far + near) / (near - far);
    o[14] = (2 * far * near) / (near - far);
    return o;
  }

  function m4lookAt(o, ex, ey, ez, cx, cy, cz, ux, uy, uz) {
    let zx = ex - cx, zy = ey - cy, zz = ez - cz;
    let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    let xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
    o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
    o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
    o[12] = -(xx * ex + xy * ey + xz * ez);
    o[13] = -(yx * ex + yy * ey + yz * ez);
    o[14] = -(zx * ex + zy * ey + zz * ez);
    o[15] = 1;
    return o;
  }

  /* Compose a model matrix. Local +Z is "forward". Rotation order Y*X*Z. */
  function m4trs(o, yaw, pitch, roll, tx, ty, tz, sx, sy, sz) {
    const cy = Math.cos(yaw), sy_ = Math.sin(yaw);
    const cx = Math.cos(pitch), sx_ = Math.sin(pitch);
    const cz = Math.cos(roll), sz_ = Math.sin(roll);
    const m00 = cy * cz + sy_ * sx_ * sz_;
    const m01 = -cy * sz_ + sy_ * sx_ * cz;
    const m02 = sy_ * cx;
    const m10 = cx * sz_;
    const m11 = cx * cz;
    const m12 = -sx_;
    const m20 = -sy_ * cz + cy * sx_ * sz_;
    const m21 = sy_ * sz_ + cy * sx_ * cz;
    const m22 = cy * cx;
    o[0] = m00 * sx; o[1] = m10 * sx; o[2] = m20 * sx; o[3] = 0;
    o[4] = m01 * sy; o[5] = m11 * sy; o[6] = m21 * sy; o[7] = 0;
    o[8] = m02 * sz; o[9] = m12 * sz; o[10] = m22 * sz; o[11] = 0;
    o[12] = tx; o[13] = ty; o[14] = tz; o[15] = 1;
    return o;
  }

  function m4invert(o, m) {
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
    const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return m4identity(o);
    det = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  }

  /* Deterministic PRNG so a "seed" replays the same city. */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------- mesh building ----------------------------- */

  /* Accumulates triangles (position / normal / colour) into flat arrays.
     Faces get baked shading offsets so shapes stay readable at distance. */
  class MeshBuilder {
    constructor() { this.pos = []; this.nor = []; this.col = []; }

    get count() { return this.pos.length / 3; }

    vert(x, y, z, nx, ny, nz, r, g, b) {
      this.pos.push(x, y, z);
      this.nor.push(nx, ny, nz);
      this.col.push(r, g, b);
    }

    /* p0..p3 wind clockwise when seen from the front, so they are emitted
       reversed to satisfy GL's counter-clockwise front-face rule. */
    quad(p0, p1, p2, p3, nx, ny, nz, c) {
      const [r, g, b] = c;
      this.vert(p0[0], p0[1], p0[2], nx, ny, nz, r, g, b);
      this.vert(p2[0], p2[1], p2[2], nx, ny, nz, r, g, b);
      this.vert(p1[0], p1[1], p1[2], nx, ny, nz, r, g, b);
      this.vert(p0[0], p0[1], p0[2], nx, ny, nz, r, g, b);
      this.vert(p3[0], p3[1], p3[2], nx, ny, nz, r, g, b);
      this.vert(p2[0], p2[1], p2[2], nx, ny, nz, r, g, b);
    }

    /* Box centred at (cx,cy,cz) with half-extents (hx,hy,hz), yaw about Y. */
    box(cx, cy, cz, hx, hy, hz, color, yaw = 0) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const rot = (x, z) => [cx + x * c + z * s, cz - x * s + z * c];
      const P = (sx, sy, sz) => {
        const [wx, wz] = rot(sx * hx, sz * hz);
        return [wx, cy + sy * hy, wz];
      };
      const shade = (t) => [color[0] * t, color[1] * t, color[2] * t];
      const nx = [c, 0, -s], nz = [s, 0, c];
      // +X / -X
      this.quad(P(1, -1, -1), P(1, -1, 1), P(1, 1, 1), P(1, 1, -1), nx[0], 0, nx[2], shade(0.88));
      this.quad(P(-1, -1, 1), P(-1, -1, -1), P(-1, 1, -1), P(-1, 1, 1), -nx[0], 0, -nx[2], shade(0.72));
      // +Z / -Z
      this.quad(P(1, -1, 1), P(-1, -1, 1), P(-1, 1, 1), P(1, 1, 1), nz[0], 0, nz[2], shade(0.95));
      this.quad(P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), -nz[0], 0, -nz[2], shade(0.66));
      // top / bottom
      this.quad(P(-1, 1, 1), P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), 0, 1, 0, shade(1.0));
      this.quad(P(-1, -1, -1), P(-1, -1, 1), P(1, -1, 1), P(1, -1, -1), 0, -1, 0, shade(0.45));
    }

    cylinder(cx, cy, cz, r, h, segs, color, taper = 1) {
      const half = h / 2;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU;
        const c0 = Math.cos(a0), s0 = Math.sin(a0);
        const c1 = Math.cos(a1), s1 = Math.sin(a1);
        const t = 0.72 + 0.28 * (0.5 + 0.5 * Math.cos(a0 - 0.9));
        const side = [color[0] * t, color[1] * t, color[2] * t];
        this.quad(
          [cx + c0 * r, cy - half, cz + s0 * r],
          [cx + c1 * r, cy - half, cz + s1 * r],
          [cx + c1 * r * taper, cy + half, cz + s1 * r * taper],
          [cx + c0 * r * taper, cy + half, cz + s0 * r * taper],
          c0, 0, s0, side);
        // cap (rim verts reversed for CCW winding seen from above)
        const top = [color[0], color[1], color[2]];
        this.vert(cx, cy + half, cz, 0, 1, 0, top[0], top[1], top[2]);
        this.vert(cx + c1 * r * taper, cy + half, cz + s1 * r * taper, 0, 1, 0, top[0], top[1], top[2]);
        this.vert(cx + c0 * r * taper, cy + half, cz + s0 * r * taper, 0, 1, 0, top[0], top[1], top[2]);
      }
    }

    /* Horizontal quad, used for ground tiles and blob shadows. */
    plane(cx, cy, cz, hx, hz, color) {
      this.quad([cx - hx, cy, cz + hz], [cx - hx, cy, cz - hz],
        [cx + hx, cy, cz - hz], [cx + hx, cy, cz + hz], 0, 1, 0, color);
    }
  }

  /* --------------------------- GL objects ------------------------------ */

  class Mesh {
    constructor(gl, builder) {
      this.gl = gl;
      this.count = builder.count;
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      const buf = (data, loc, size) => {
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      };
      buf(builder.pos, 0, 3);
      buf(builder.nor, 1, 3);
      buf(builder.col, 2, 3);
      gl.bindVertexArray(null);
    }
  }

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh) + '\n' + src);
    }
    return sh;
  }

  function program(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.bindAttribLocation(p, 1, 'aNor');
    gl.bindAttribLocation(p, 2, 'aCol');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p));
    }
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { prog: p, u };
  }

  const SCENE_VS = `#version 300 es
  precision highp float;
  in vec3 aPos; in vec3 aNor; in vec3 aCol;
  uniform mat4 uProj, uView, uModel;
  uniform vec3 uCam;
  out vec3 vNor; out vec3 vCol; out float vFog; out vec3 vWorld;
  void main(){
    vec4 w = uModel * vec4(aPos, 1.0);
    vWorld = w.xyz;
    vNor = normalize(mat3(uModel) * aNor);
    vCol = aCol;
    vFog = length(w.xyz - uCam);
    gl_Position = uProj * uView * w;
  }`;

  const SCENE_FS = `#version 300 es
  precision highp float;
  in vec3 vNor; in vec3 vCol; in float vFog; in vec3 vWorld;
  uniform vec3 uTint;
  uniform vec3 uSun;
  uniform vec3 uSunCol;
  uniform vec3 uFogCol;
  uniform float uFogDensity;
  uniform float uEmissive;
  uniform float uAlpha;
  out vec4 outColor;
  void main(){
    vec3 base = vCol * uTint;
    vec3 n = normalize(vNor);
    float ndl = max(dot(n, uSun), 0.0);
    // hemisphere ambient: cool sky above, bounced sand below
    float hemi = 0.5 + 0.5 * n.y;
    vec3 ambient = mix(vec3(0.34, 0.29, 0.23), vec3(0.48, 0.52, 0.64), hemi);
    vec3 lit = base * (ambient + uSunCol * ndl * 1.25);
    lit = mix(lit, base * 1.35, uEmissive);
    // exponential-squared haze; distant city dissolves into the dawn
    float f = 1.0 - exp(-pow(vFog * uFogDensity, 2.0));
    f *= mix(1.0, 0.55, clamp(uEmissive, 0.0, 1.0));
    vec3 col = mix(lit, uFogCol, clamp(f, 0.0, 1.0));
    outColor = vec4(col, uAlpha);
  }`;

  const SKY_VS = `#version 300 es
  precision highp float;
  in vec3 aPos;
  out vec2 vUv;
  void main(){ vUv = aPos.xy; gl_Position = vec4(aPos.xy, 1.0, 1.0); }`;

  const SKY_FS = `#version 300 es
  precision highp float;
  in vec2 vUv;
  uniform mat4 uInvVP;
  uniform vec3 uSun;
  uniform vec3 uFogCol;
  out vec4 outColor;
  void main(){
    vec4 p = uInvVP * vec4(vUv, 1.0, 1.0);
    vec3 dir = normalize(p.xyz / p.w);
    float h = clamp(dir.y, -1.0, 1.0);
    vec3 zenith = vec3(0.16, 0.28, 0.52);
    vec3 mid    = vec3(0.48, 0.55, 0.70);
    vec3 col = mix(mid, zenith, pow(clamp(h, 0.0, 1.0), 0.55));
    col = mix(uFogCol, col, smoothstep(-0.02, 0.30, h));
    // sun disc + broad glow
    float d = max(dot(dir, uSun), 0.0);
    col += vec3(1.0, 0.72, 0.42) * pow(d, 24.0) * 0.85;
    col += vec3(1.0, 0.60, 0.35) * pow(d, 3.0) * 0.20;
    // ground haze below the horizon
    col = mix(col, uFogCol * 0.72, smoothstep(0.0, -0.15, h));
    outColor = vec4(col, 1.0);
  }`;

  class Renderer {
    constructor(canvas) {
      const gl = canvas.getContext('webgl2', {
        antialias: true, alpha: false, powerPreference: 'high-performance',
      });
      if (!gl) throw new Error('WebGL2 unavailable');
      this.gl = gl;
      this.canvas = canvas;
      this.scene = program(gl, SCENE_VS, SCENE_FS);
      this.sky = program(gl, SKY_VS, SKY_FS);

      const q = new MeshBuilder();
      q.vert(-1, -1, 0, 0, 0, 1, 1, 1, 1);
      q.vert(3, -1, 0, 0, 0, 1, 1, 1, 1);
      q.vert(-1, 3, 0, 0, 0, 1, 1, 1, 1);
      this.fullscreen = new Mesh(gl, q);

      this.proj = m4();
      this.view = m4();
      this.viewProj = m4();
      this.invVP = m4();
      this._model = m4();

      // High and behind the shooter's right shoulder, so the faces of the town
      // you are actually looking at catch the light.
      this.sun = [0.52, 0.60, 0.61];
      const sl = Math.hypot(...this.sun);
      this.sun = this.sun.map((v) => v / sl);
      this.sunCol = [1.0, 0.88, 0.70];
      this.fogCol = [0.80, 0.745, 0.64];
      this.fogDensity = 0.00055;

      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
    }

    resize() {
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      const w = Math.floor(this.canvas.clientWidth * dpr);
      const h = Math.floor(this.canvas.clientHeight * dpr);
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w; this.canvas.height = h;
      }
      this.gl.viewport(0, 0, w, h);
      return w / Math.max(h, 1);
    }

    beginFrame(camPos, camTarget, fovDeg, roll) {
      const gl = this.gl;
      const aspect = this.resize();
      m4perspective(this.proj, (fovDeg * Math.PI) / 180, aspect, 0.6, 4200);
      const up = [Math.sin(roll || 0), Math.cos(roll || 0), 0];
      m4lookAt(this.view, camPos[0], camPos[1], camPos[2],
        camTarget[0], camTarget[1], camTarget[2], up[0], up[1], up[2]);
      m4mul(this.viewProj, this.proj, this.view);
      m4invert(this.invVP, this.viewProj);
      this.camPos = camPos;

      gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // sky first, no depth
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.useProgram(this.sky.prog);
      gl.uniformMatrix4fv(this.sky.u.uInvVP, false, this.invVP);
      gl.uniform3fv(this.sky.u.uSun, this.sun);
      gl.uniform3fv(this.sky.u.uFogCol, this.fogCol);
      gl.bindVertexArray(this.fullscreen.vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);

      gl.useProgram(this.scene.prog);
      const u = this.scene.u;
      gl.uniformMatrix4fv(u.uProj, false, this.proj);
      gl.uniformMatrix4fv(u.uView, false, this.view);
      gl.uniform3fv(u.uCam, camPos);
      gl.uniform3fv(u.uSun, this.sun);
      gl.uniform3fv(u.uSunCol, this.sunCol);
      gl.uniform3fv(u.uFogCol, this.fogCol);
      gl.uniform1f(u.uFogDensity, this.fogDensity);
      this.setMaterial(1, 1, 1, 0, 1);
    }

    setMaterial(r, g, b, emissive, alpha) {
      const gl = this.gl, u = this.scene.u;
      gl.uniform3f(u.uTint, r, g, b);
      gl.uniform1f(u.uEmissive, emissive);
      gl.uniform1f(u.uAlpha, alpha);
    }

    draw(mesh, model) {
      const gl = this.gl;
      gl.uniformMatrix4fv(this.scene.u.uModel, false, model);
      gl.bindVertexArray(mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }

    /* Convenience: place a mesh with rotation/translation/uniform-ish scale. */
    drawAt(mesh, yaw, pitch, roll, x, y, z, sx, sy, sz) {
      m4trs(this._model, yaw, pitch, roll, x, y, z, sx, sy, sz);
      this.draw(mesh, this._model);
    }
  }

  global.E = {
    TAU, clamp, lerp, damp, mulberry32,
    m4, m4identity, m4mul, m4perspective, m4lookAt, m4trs, m4invert,
    MeshBuilder, Mesh, Renderer,
  };
})(window);
