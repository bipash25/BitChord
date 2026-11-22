import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissToast, showToast, useToast } from './toast';

describe('QueueActionNotice toast store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    dismissToast();
  });

  afterEach(() => {
    dismissToast();
    vi.useRealTimers();
  });

  it('publishes monotonic notice ids so repeated messages restart their lifetime', () => {
    const id1 = showToast('Added to queue', 2000);
    expect(useToast.getState().notice).toEqual({ id: id1, message: 'Added to queue' });

    vi.advanceTimersByTime(1500);
    const id2 = showToast('Added to queue', 2000);
    expect(id2).toBeGreaterThan(id1);
    expect(useToast.getState().notice).toEqual({ id: id2, message: 'Added to queue' });

    // Old timer at 2000ms must not dismiss the newer notice.
    vi.advanceTimersByTime(600);
    expect(useToast.getState().notice).toEqual({ id: id2, message: 'Added to queue' });

    // Full duration from second show dismisses it cleanly.
    vi.advanceTimersByTime(1400);
    expect(useToast.getState().notice).toBeNull();
  });

  it('ignores blank messages and supports manual dismiss', () => {
    expect(showToast('   ')).toBe(0);
    expect(useToast.getState().notice).toBeNull();

    showToast('Playing next', 5000);
    expect(useToast.getState().notice?.message).toBe('Playing next');
    dismissToast();
    expect(useToast.getState().notice).toBeNull();
  });
});
