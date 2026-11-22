import { useEffect, useRef, useState } from 'react';
import { artworkAtPixels } from '@/lib/artwork';
import { GRID, MESH_FADE_MS, meshPalette, type Rgb } from '@/lib/meshPalette';
import { useReducedBlur, useReducedMotion } from '@/lib/motionPrefs';

/** How long the bottom seam glides to a new edge (NowPlayingScreen.kt:305). */
export const MESH_SEAM_MOVE_MS = 320;

/** How long a new cover takes to cover the last one behind the lyrics (ArtworkMeshBackdrop.kt:150). */
export const FULL_BLUR_CROSSFADE_MS = 320;

/** FastOutSlowIn, the easing both backdrop crossfades run on. */
const FAST_OUT_SLOW_IN = 'cubic-bezier(0.4, 0, 0.2, 1)';

/** FullArtworkScrim (ArtworkMeshBackdrop.kt:406-410): 34% → 48% → 64% down the panel. */
const FULL_BLUR_SCRIM =
  'linear-gradient(to bottom, rgba(0, 0, 0, 0.34) 0%, rgba(0, 0, 0, 0.48) 55%, rgba(0, 0, 0, 0.64) 100%)';

/** Drawn only until an artwork has been read (ArtworkMeshBackdrop.kt:413). */
const FALLBACK_HEX = '#121212';

const FALLBACK: Rgb[] = Array.from({ length: GRID * GRID }, () => [18, 18, 18]);

const VERTEX = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAGMENT = `
precision highp float;
uniform vec2 uRes;
uniform float uSeam;
uniform vec3 uCol[${GRID * GRID}];
uniform float uFrame;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031 + uFrame * 0.0137);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float sstep(float t) {
  float x = clamp(t, 0.0, 1.0);
  return x * x * (3.0 - 2.0 * x);
}

vec3 sampleCell(int c, int r) {
  int idx = r * ${GRID} + c;
  for (int i = 0; i < ${GRID * GRID}; i++) {
    if (i == idx) return pow(uCol[i], vec3(2.2));
  }
  return vec3(0.0);
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  float seamPx = clamp(uSeam, 0.0, uRes.y);
  float u = px.x / max(1.0, uRes.x);
  // Above the seam: row 0 (sleeve bottom edge) held vertically; below: rows 0..5.
  float v = px.y <= seamPx ? 0.0 : (px.y - seamPx) / max(1.0, uRes.y - seamPx);

  float fx = u * float(${GRID}) - 0.5;
  float fy = v * float(${GRID}) - 0.5;
  int x0 = int(clamp(floor(fx), 0.0, float(${GRID - 1})));
  int y0 = int(clamp(floor(fy), 0.0, float(${GRID - 1})));
  int x1 = min(x0 + 1, ${GRID - 1});
  int y1 = min(y0 + 1, ${GRID - 1});
  float wx = sstep(fx - float(x0));
  float wy = sstep(fy - float(y0));

  vec3 top = mix(sampleCell(x0, y0), sampleCell(x1, y0), wx);
  vec3 bottom = mix(sampleCell(x0, y1), sampleCell(x1, y1), wx);
  vec3 color = pow(mix(top, bottom, wy), vec3(1.0 / 2.2));
  color += (hash(gl_FragCoord.xy) + hash(gl_FragCoord.yx + 17.0) - 1.0) / 255.0;
  gl_FragColor = vec4(color, 1.0);
}`;

interface Renderer {
  draw: (cells: Rgb[], seamCssPx: number) => void;
  dispose: () => void;
}

function mixCells(from: Rgb[], to: Rgb[], k: number): Rgb[] {
  return to.map((c, i) => c.map((v, j) => from[i]![j]! + (v - from[i]![j]!) * k) as Rgb);
}

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** FastOutSlowIn-like cubic ease out matching Compose FastOutSlowInEasing. */
function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}

function webglRenderer(canvas: HTMLCanvasElement): Renderer | null {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
  if (!gl) return null;
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vertex = shader(gl.VERTEX_SHADER, VERTEX);
  const fragment = shader(gl.FRAGMENT_SHADER, FRAGMENT);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram()!;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const at = (name: string) => gl.getUniformLocation(program, name);
  const [uRes, uSeam, uCol, uFrame] = ['uRes', 'uSeam', 'uCol', 'uFrame'].map(at);
  let frame = 0;

  return {
    draw(cells, seamCssPx) {
      const scale = Math.min(window.devicePixelRatio || 1, 1);
      const width = Math.max(1, Math.round(canvas.clientWidth * scale));
      const height = Math.max(1, Math.round(canvas.clientHeight * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.uniform2f(uRes!, width, height);
      gl.uniform1f(uSeam!, seamCssPx * scale);
      gl.uniform3fv(
        uCol!,
        cells.flatMap((c) => c.map((v) => v / 255)),
      );
      gl.uniform1f(uFrame!, (frame = (frame + 1) % 1024));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    },
  };
}

/** 32×32 smoothstep-resampled 2D fallback matching ArtworkMeshBackdrop.kt:697-715. */
const TEX_SIZE = 32;
function canvasRenderer(canvas: HTMLCanvasElement): Renderer | null {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return null;
  const offscreen = document.createElement('canvas');
  offscreen.width = TEX_SIZE;
  offscreen.height = TEX_SIZE;
  const offCtx = offscreen.getContext('2d');
  if (!offCtx) return null;
  const img = offCtx.createImageData(TEX_SIZE, TEX_SIZE);

  return {
    draw(cells, seamCssPx) {
      const width = Math.max(1, Math.round(canvas.clientWidth));
      const height = Math.max(1, Math.round(canvas.clientHeight));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      for (let ty = 0; ty < TEX_SIZE; ty++) {
        const fy = ((ty + 0.5) / TEX_SIZE) * GRID - 0.5;
        const y0 = Math.min(GRID - 1, Math.max(0, Math.floor(fy)));
        const y1 = Math.min(GRID - 1, y0 + 1);
        const wy = smoothstep(fy - y0);
        for (let tx = 0; tx < TEX_SIZE; tx++) {
          const fx = ((tx + 0.5) / TEX_SIZE) * GRID - 0.5;
          const x0 = Math.min(GRID - 1, Math.max(0, Math.floor(fx)));
          const x1 = Math.min(GRID - 1, x0 + 1);
          const wx = smoothstep(fx - x0);
          const c00 = cells[y0 * GRID + x0]!;
          const c10 = cells[y0 * GRID + x1]!;
          const c01 = cells[y1 * GRID + x0]!;
          const c11 = cells[y1 * GRID + x1]!;
          const idx = (ty * TEX_SIZE + tx) * 4;
          for (let ch = 0; ch < 3; ch++) {
            const top = c00[ch]! + (c10[ch]! - c00[ch]!) * wx;
            const bot = c01[ch]! + (c11[ch]! - c01[ch]!) * wx;
            img.data[idx + ch] = Math.round(top + (bot - top) * wy);
          }
          img.data[idx + 3] = 255;
        }
      }
      offCtx.putImageData(img, 0, 0);
      const seam = Math.min(height, Math.max(0, Math.round(seamCssPx)));
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      if (seam > 0) {
        // Hold row 0 from top of viewport down to seam.
        context.drawImage(offscreen, 0, 0, TEX_SIZE, 1, 0, 0, width, seam);
      }
      context.drawImage(offscreen, 0, 0, TEX_SIZE, TEX_SIZE, 0, seam, width, Math.max(1, height - seam));
    },
    dispose() {},
  };
}

export interface BlurredArtworkBackdropProps {
  artworkUrl: string | null;
}

/**
 * Android `FullArtworkBlurBackdrop` (ArtworkMeshBackdrop.kt:128-168): the blurred
 * cover the lyrics stand on — one 120px copy cropped across the bounds and blurred
 * in place, under the 34/48/64% scrim that keeps white lyric type readable.
 *
 * A new cover crossfades in over the last one in 320ms FastOutSlowIn, and the old
 * cover stays painted until the new image has actually loaded — the web's stand-in
 * for the prepared-bitmap cache that keeps a skip from dropping the backdrop to
 * the fallback grey. Reduced motion cuts the crossfade to a swap; the app's
 * reduced-blur contract trades the cover for the opaque fallback grey rather
 * than paying for a viewport-wide live blur.
 */
export function BlurredArtworkBackdrop({ artworkUrl }: BlurredArtworkBackdropProps) {
  const reducedMotion = useReducedMotion();
  const reducedBlur = useReducedBlur();
  const img = useRef<HTMLImageElement>(null);
  // The cover on top, and the one it is covering while the crossfade runs.
  const [covers, setCovers] = useState<{ shown: string | null; outgoing: string | null }>({
    shown: artworkUrl,
    outgoing: null,
  });
  // The incoming cover only starts its fade once it has decoded; until then the
  // outgoing one keeps the panel from dipping to the fallback.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (covers.shown !== artworkUrl) {
      setReady(false);
      setCovers((s) =>
        s.shown === artworkUrl ? s : { shown: artworkUrl, outgoing: reducedMotion ? null : s.shown },
      );
    }
  }, [artworkUrl, covers.shown, reducedMotion]);

  // Retire the covered image only once the crossfade that covers it has run —
  // a cover that never loads leaves the last one standing, as Android's
  // prepared-bitmap cache does on a failed decode.
  useEffect(() => {
    if (!covers.outgoing || !ready) return;
    const timer = setTimeout(
      () => setCovers((s) => ({ shown: s.shown, outgoing: null })),
      FULL_BLUR_CROSSFADE_MS,
    );
    return () => clearTimeout(timer);
  }, [covers.outgoing, covers.shown, ready]);

  // A cached image can already be complete before the load handler attaches.
  useEffect(() => {
    const el = img.current;
    if (el?.complete && el.naturalWidth > 0) setReady(true);
  }, [covers.shown]);

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ backgroundColor: FALLBACK_HEX }}
      aria-hidden="true"
      data-blur-backdrop
    >
      {!reducedBlur && covers.outgoing && (
        <img
          src={artworkAtPixels(covers.outgoing, 120)}
          alt=""
          referrerPolicy="no-referrer"
          decoding="async"
          className="absolute inset-0 size-full scale-115 object-cover blur-[42px] saturate-125"
        />
      )}
      {!reducedBlur && covers.shown && (
        <img
          ref={img}
          src={artworkAtPixels(covers.shown, 120)}
          alt=""
          referrerPolicy="no-referrer"
          decoding="async"
          onLoad={() => setReady(true)}
          className="absolute inset-0 size-full scale-115 object-cover blur-[42px] saturate-125"
          style={{
            opacity: ready ? 1 : 0,
            transition: reducedMotion ? 'none' : `opacity ${FULL_BLUR_CROSSFADE_MS}ms ${FAST_OUT_SLOW_IN}`,
          }}
        />
      )}
      <div className="pointer-events-none absolute inset-0" style={{ background: FULL_BLUR_SCRIM }} />
    </div>
  );
}

export interface MeshBackdropProps {
  artworkUrl: string | null;
  /** Portrait artwork bottom edge in px from top of viewport; 0 stretches full screen. */
  seamY?: number;
  /** 'mesh' = anchored 6×6 mesh (player default); 'fullBlur' = blurred cover (lyrics/queue/theater). */
  mode?: 'mesh' | 'fullBlur';
}

/**
 * Android-ported player backdrop (`ArtworkMeshBackdrop.kt`):
 * - `'mesh'`: 6×6 bottom-seam-anchored sleeve mesh, still except for 900ms track
 *   crossfades and 320ms seam glides, under a black 6%→30% vertical scrim.
 * - `'fullBlur'`: `BlurredArtworkBackdrop` — the 120px blurred sleeve under a
 *   34%→48%→64% scrim, crossfading covers on a track change (lyrics/queue/theater).
 */
export function MeshBackdrop({ artworkUrl, seamY = 0, mode = 'mesh' }: MeshBackdropProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useReducedMotion();
  const [generation, setGeneration] = useState(0);
  const [fallback, setFallback] = useState(false);

  const state = useRef({
    from: FALLBACK,
    to: FALLBACK,
    fadeStart: -Infinity,
    seamFrom: seamY,
    seamTo: seamY,
    seamStart: -Infinity,
    wake: () => {},
  });

  useEffect(() => {
    if (!artworkUrl) return;
    let live = true;
    meshPalette(artworkUrl)
      .then((cells) => {
        if (!live) return;
        const s = state.current;
        const now = performance.now();
        if (s.fadeStart === -Infinity || reducedMotion) {
          s.from = cells;
          s.to = cells;
          s.fadeStart = now - MESH_FADE_MS;
        } else {
          const progress = Math.min(1, (now - s.fadeStart) / MESH_FADE_MS);
          s.from = mixCells(s.from, s.to, easeOutCubic(progress));
          s.to = cells;
          s.fadeStart = now;
        }
        s.wake();
      })
      .catch(() => {
        // Unreadable sleeve keeps whatever colours are already painted.
      });
    return () => {
      live = false;
    };
  }, [artworkUrl, reducedMotion]);

  useEffect(() => {
    const s = state.current;
    const now = performance.now();
    if (reducedMotion || s.seamTo === 0 || seamY === 0 || s.seamStart === -Infinity) {
      s.seamFrom = seamY;
      s.seamTo = seamY;
      s.seamStart = now - MESH_SEAM_MOVE_MS;
    } else if (Math.abs(s.seamTo - seamY) > 0.5) {
      const progress = Math.min(1, (now - s.seamStart) / MESH_SEAM_MOVE_MS);
      s.seamFrom = s.seamFrom + (s.seamTo - s.seamFrom) * easeOutCubic(progress);
      s.seamTo = seamY;
      s.seamStart = now;
    }
    s.wake();
  }, [seamY, reducedMotion]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const renderer = fallback ? canvasRenderer(el) : webglRenderer(el);
    if (!renderer) {
      if (!fallback) setFallback(true);
      return;
    }
    const s = state.current;
    let frame = 0;

    const tick = (now: number) => {
      frame = 0;
      const colorProgress = reducedMotion || s.fadeStart === -Infinity ? 1 : Math.min(1, (now - s.fadeStart) / MESH_FADE_MS);
      const seamProgress = reducedMotion || s.seamStart === -Infinity ? 1 : Math.min(1, (now - s.seamStart) / MESH_SEAM_MOVE_MS);

      const cells = colorProgress < 1 ? mixCells(s.from, s.to, easeOutCubic(colorProgress)) : s.to;
      const currentSeam =
        seamProgress < 1 ? s.seamFrom + (s.seamTo - s.seamFrom) * easeOutCubic(seamProgress) : s.seamTo;

      renderer.draw(cells, currentSeam);

      if (colorProgress < 1 || seamProgress < 1) {
        frame = requestAnimationFrame(tick);
      }
    };

    s.wake = () => {
      if (!frame) {
        frame = requestAnimationFrame(tick);
      }
    };

    const resized = new ResizeObserver(() => s.wake());
    resized.observe(el);
    const lost = (e: Event) => {
      e.preventDefault();
      setGeneration((g) => g + 1);
    };
    el.addEventListener('webglcontextlost', lost);
    s.wake();

    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
      el.removeEventListener('webglcontextlost', lost);
      renderer.dispose();
      s.wake = () => {};
    };
  }, [generation, fallback, reducedMotion]);

  const showFullBlur = mode === 'fullBlur';

  return (
    <div
      className="absolute inset-0 -z-1 overflow-hidden"
      style={{ backgroundColor: FALLBACK_HEX }}
      aria-hidden="true"
      data-fallback={fallback || undefined}
      data-mode={mode}
    >
      <canvas key={`${generation}-${fallback}`} ref={canvas} className="absolute inset-0 size-full" />
      {/* ArtworkMeshBackdrop.kt:358-365: subtle black 6%→30% scrim for white text legibility. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.06), rgba(0, 0, 0, 0.3))' }}
      />

      {/* Full-cover blur (NowPlayingScreen.kt:2368-2377): 360ms FastOutSlowIn
          over the mesh when the lyrics/queue columns open; the cover-change
          crossfade inside it is BlurredArtworkBackdrop's own. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          opacity: showFullBlur ? 1 : 0,
          transition: reducedMotion ? 'none' : `opacity 360ms ${FAST_OUT_SLOW_IN}`,
        }}
      >
        <BlurredArtworkBackdrop artworkUrl={artworkUrl} />
      </div>
    </div>
  );
}
