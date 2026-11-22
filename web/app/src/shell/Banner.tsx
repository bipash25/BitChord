import { X } from 'lucide-react';
import type { ReactNode } from 'react';

interface BannerProps {
  title: string;
  detail: string;
  action: ReactNode;
  onDismiss?: () => void;
}

/**
 * Relay notice strip (`QueueActionNotice.kt`, spec §6.23): menu frost with
 * 0.5px glass rim instead of Apple's red banner band.
 */
export function Banner({ title, detail, action, onDismiss }: BannerProps) {
  return (
    <div
      className="bc-frost relative z-(--z-web-chrome) flex min-h-[64px] items-center gap-4 border-t-[0.5px] border-t-(--bc-glass-edge) px-(--bc-page-gutter) py-3 text-(--bc-on-surface) sm:px-7"
      role="region"
      aria-label={title}
    >
      <div className="min-w-0 flex-1">
        <p className="bc-type-title-md">{title}</p>
        <p className="mt-0.5 bc-type-body text-(--bc-on-surface-variant)">{detail}</p>
      </div>
      <div className="shrink-0">{action}</div>
      {onDismiss && (
        <button
          className="-mr-2 grid size-8 place-items-center rounded-full text-(--bc-on-surface-variant) hover:bg-(--bc-hover-fill)"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          <X size={16} strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}

export const bannerButtonClass =
  'inline-flex h-8 items-center whitespace-nowrap rounded-full bg-(--bc-primary) px-4 bc-type-label text-(--bc-on-primary) hover:opacity-90';
