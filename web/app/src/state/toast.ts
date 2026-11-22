import { create } from 'zustand';

export const DEFAULT_TOAST_DURATION_MS = 2600;

export interface ToastNotice {
  readonly id: number;
  readonly message: string;
}

interface ToastState {
  notice: ToastNotice | null;
  show: (message: string, durationMs?: number) => number;
  dismiss: () => void;
}

let nextNoticeId = 0;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

function clearDismissTimer() {
  if (dismissTimer !== null) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
}

/**
 * Brief queue & action confirmation store (`QueueActionNotice.kt`, spec §6.23).
 * Each call stamps a fresh monotonic `id` so repeating the same action
 * restarts both its lifetime and entrance transition.
 */
export const useToast = create<ToastState>()((set) => ({
  notice: null,
  show(message, durationMs = DEFAULT_TOAST_DURATION_MS) {
    const trimmed = message.trim();
    if (!trimmed) return 0;
    clearDismissTimer();
    const id = ++nextNoticeId;
    set({ notice: { id, message: trimmed } });
    if (durationMs > 0) {
      dismissTimer = setTimeout(() => {
        dismissTimer = null;
        set((state) => (state.notice?.id === id ? { notice: null } : state));
      }, durationMs);
    }
    return id;
  },
  dismiss() {
    clearDismissTimer();
    set({ notice: null });
  },
}));

export function showToast(message: string, durationMs?: number): number {
  return useToast.getState().show(message, durationMs);
}

export function dismissToast(): void {
  useToast.getState().dismiss();
}
