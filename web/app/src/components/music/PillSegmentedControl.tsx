import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface PillSegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
  className?: string;
}

/**
 * Android's `PillSegmentedControl` (`PillSegmentedControl.kt:60-213`, spec §6.4):
 * squircle track (`rgba(118,118,128,0.12)` light / `0.24` dark), 4px inset,
 * sliding white/lifted-grey pill, 12px Semibold labels.
 */
export function PillSegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label = 'Filter',
  className = '',
}: PillSegmentedControlProps<T>) {
  const trackRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  const measure = () => {
    const track = trackRef.current;
    const btn = btnRefs.current[selectedIndex];
    if (!track || !btn) return;
    setPill({ left: btn.offsetLeft, width: btn.offsetWidth });
  };

  useLayoutEffect(measure, [selectedIndex, options.length]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    return () => ro.disconnect();
  });

  useEffect(() => {
    const btn = btnRefs.current[selectedIndex];
    btn?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [selectedIndex]);

  if (options.length === 0) return null;

  return (
    <div
      className={`bc-pill-squircle relative w-full overflow-x-auto bg-(--bc-segmented-bg) p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
      role="tablist"
      aria-label={label}
    >
      <div ref={trackRef} className="relative flex min-w-full">
        {pill && (
          <div
            aria-hidden="true"
            className="bc-pill-squircle pointer-events-none absolute inset-y-0 left-0 bg-(--bc-segmented-pill) shadow-[0_1px_4px_rgba(0,0,0,0.12)] transition-[transform,width] duration-260 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
            style={{ width: pill.width, transform: `translate3d(${pill.left}px, 0, 0)` }}
          />
        )}
        {options.map((opt, idx) => {
          const selected = opt.value === value;
          return (
            <button
              key={opt.value}
              ref={(el) => {
                btnRefs.current[idx] = el;
              }}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => {
                if (opt.value !== value) onChange(opt.value);
              }}
              className="relative z-1 flex-1 shrink-0 px-3 py-[9px] text-center whitespace-nowrap bc-type-label text-(--bc-on-surface) sm:px-[18px]"
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
