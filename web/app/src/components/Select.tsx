import { ChevronsUpDown } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Menu, MenuItem } from './Menu';

export interface SelectOption<T> {
  value: T;
  label: string;
}

interface SelectProps<T> {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  /** Names the menu for assistive tech, e.g. "Crossfade". */
  label: string;
}

/**
 * Apple's pop-up button (the macOS settings idiom): the current choice and a
 * ⌃⌄ glyph, opening the app's own contextual menu with a checkmark on it.
 * Replaces the native <select>, whose list Windows draws white-on-light
 * against the dark theme, in the system font, unreadable.
 *
 * Inside a settings row's <label>, a click anywhere on the row opens it.
 */
export function Select<T extends string | number>({ value, options, onChange, label }: SelectProps<T>) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <button
        type="button"
        className="inline-flex max-w-[240px] min-w-0 flex-none cursor-pointer items-center gap-1.5 rounded-[10px] bg-(--bc-tab-pill-bg) py-1.5 ps-3 pe-2 bc-type-body text-(--bc-on-surface) transition-opacity hover:opacity-85 aria-expanded:opacity-85"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        <span className="min-w-0 truncate">{current?.label ?? ''}</span>
        <ChevronsUpDown size={14} strokeWidth={2.2} className="flex-none text-(--bc-on-surface-variant)" />
      </button>
      {anchor && (
        <Menu anchor={anchor} onClose={close} label={label} matchWidth>
          {options.map((o) => (
            <MenuItem
              key={String(o.value)}
              checked={o.value === value}
              onSelect={() => {
                close();
                if (o.value !== value) onChange(o.value);
                anchor.focus();
              }}
            >
              {o.label}
            </MenuItem>
          ))}
        </Menu>
      )}
    </>
  );
}
