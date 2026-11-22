import { useMemo } from 'react';
import { encode } from 'uqr';

export const QR_QUIET_ZONE_PX = 12;
export const QR_DOT_SCALE = 0.86;
export const QR_DOT_RADIUS_RATIO = 0.3;

export interface QrModuleRect {
  x: number;
  y: number;
  size: number;
  rx: number;
}

export interface QrRenderGeometry {
  modules: number;
  innerSide: number;
  rects: QrModuleRect[];
}

/**
 * Encodes `content` at error-correction level M (15% tolerance for phone-to-phone
 * camera scans) with zero internal border (`quietZone` is padded outside) and
 * emits rounded-square module geometry matching `QrCode.kt:110-150`.
 */
export function buildQrGeometry(content: string, innerSide: number): QrRenderGeometry | null {
  const trimmed = content.trim();
  if (!trimmed || innerSide <= 0) return null;
  const result = encode(trimmed, { ecc: 'M', border: 0 });
  const modules = result.size;
  if (modules <= 0) return null;

  const cell = innerSide / modules;
  const dot = cell * QR_DOT_SCALE;
  const rx = dot * QR_DOT_RADIUS_RATIO;
  const inset = (cell - dot) / 2;

  const rects: QrModuleRect[] = [];
  for (let y = 0; y < modules; y++) {
    const row = result.data[y];
    if (!row) continue;
    for (let x = 0; x < modules; x++) {
      if (!row[x]) continue;
      rects.push({
        x: Number((x * cell + inset).toFixed(2)),
        y: Number((y * cell + inset).toFixed(2)),
        size: Number(dot.toFixed(2)),
        rx: Number(rx.toFixed(2)),
      });
    }
  }
  return { modules, innerSide, rects };
}

export interface QrCodeProps {
  content: string;
  size?: number;
  quietZone?: number;
  foreground?: string;
  background?: string;
  className?: string;
  label?: string;
}

/**
 * Android-ported party invite QR square (`QrCode.kt:58-152`, spec §6.10):
 * rounded modules (`0.86×` cell, `0.3×` corner radius), EC level M,
 * 16px outer card corner, and 12px quiet zone.
 */
export function QrCode({
  content,
  size = 148,
  quietZone = QR_QUIET_ZONE_PX,
  foreground = '#000000',
  background = '#ffffff',
  className = '',
  label = 'Party invite QR code',
}: QrCodeProps) {
  const innerSide = Math.max(0, size - quietZone * 2);
  const geometry = useMemo(() => buildQrGeometry(content, innerSide), [content, innerSide]);

  return (
    <div
      className={`inline-flex shrink-0 items-center justify-center rounded-[16px] border-[0.5px] border-(--bc-outline) shadow-(--bc-shadow-glass) ${className}`}
      style={{ width: size, height: size, padding: quietZone, backgroundColor: background }}
      role="img"
      aria-label={label}
    >
      {geometry && (
        <svg
          width={geometry.innerSide}
          height={geometry.innerSide}
          viewBox={`0 0 ${geometry.innerSide} ${geometry.innerSide}`}
          aria-hidden="true"
        >
          {geometry.rects.map((r, i) => (
            <rect key={i} x={r.x} y={r.y} width={r.size} height={r.size} rx={r.rx} ry={r.rx} fill={foreground} />
          ))}
        </svg>
      )}
    </div>
  );
}
