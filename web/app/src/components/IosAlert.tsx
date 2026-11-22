import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface IosAlertProps {
  onClose: () => void;
  label: string;
  /** 'alert' = 270px UIAlertController card; 'dialog' = 400px; 'wide' = 520px. */
  size?: 'alert' | 'dialog' | 'wide';
  children: ReactNode;
}

const SIZE_CLASSES: Record<NonNullable<IosAlertProps['size']>, string> = {
  alert: 'w-[min(var(--bc-alert-w),calc(100vw-32px))]',
  dialog: 'w-[min(400px,calc(100vw-32px))]',
  wide: 'w-[min(520px,calc(100vw-32px))]',
};

/**
 * Android-ported iOS alert card (`UpdateAvailableDialog.kt`, spec §3.9, §4.9):
 * 270px fixed alert card (or wider dialog variant), 14px continuous corner,
 * frosted surface (opaque under reduced-transparency/blur), 0.5px hairline
 * rules, and 28% flat scrim.
 */
export function IosAlert({ onClose, label, size = 'alert', children }: IosAlertProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-(--z-modal) grid animate-fade place-items-center bg-(--bc-alert-scrim)"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`bc-alert-surface bc-continuous flex max-h-[min(720px,calc(100vh-32px))] animate-zoom flex-col overflow-hidden rounded-(--bc-radius-alert) text-(--bc-on-surface) shadow-(--bc-shadow-menu) ${SIZE_CLASSES[size]}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Centered iOS alert body: 17px Semibold title over 13px body copy (`UpdateAvailableDialog.kt:138-168`). */
export function IosAlertBody({ title, message, children }: { title: string; message?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-[19px] text-center">
      <h2 className="font-(family-name:--bc-font-family) text-[17px] leading-[22px] font-semibold text-(--bc-on-surface)">
        {title}
      </h2>
      {message && (
        <p className="mt-1 font-(family-name:--bc-font-family) text-[13px] leading-[17px] text-(--bc-on-surface-variant)">
          {message}
        </p>
      )}
      {children}
    </div>
  );
}

/** 0.5px hairline separator inside an iOS alert card (`UpdateAvailableDialog.kt:317-324`). */
export function IosAlertRule({ className = '' }: { className?: string }) {
  return <div className={`h-[0.5px] w-full shrink-0 bg-(--bc-alert-rule) ${className}`} role="separator" />;
}

export interface IosAlertActionProps {
  label: string;
  onClick: () => void;
  emphasised?: boolean;
  destructive?: boolean;
  disabled?: boolean;
}

/**
 * Full-bleed 44px alert action row (`UpdateAvailableDialog.kt:278-313`):
 * tinted wash on hover/press instead of a filled button or Material ripple.
 */
export function IosAlertAction({
  label,
  onClick,
  emphasised = false,
  destructive = false,
  disabled = false,
}: IosAlertActionProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`grid h-(--bc-alert-action-h) w-full shrink-0 place-items-center font-(family-name:--bc-font-family) text-[17px] leading-[22px] transition-colors enabled:hover:bg-[color-mix(in_srgb,var(--bc-on-surface)_9%,transparent)] enabled:active:bg-[color-mix(in_srgb,var(--bc-on-surface)_9%,transparent)] disabled:opacity-40 ${
        emphasised ? 'font-semibold' : 'font-normal'
      } ${destructive ? 'text-(--bc-accent-red)' : 'text-(--bc-primary)'}`}
    >
      {label}
    </button>
  );
}
