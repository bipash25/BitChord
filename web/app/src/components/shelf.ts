/*
 * Horizontal shelves (`HomeScreen.kt`, `Common.kt:163-209`, spec §2.5 & §6.2):
 * 16px page gutters, 150px square cards, 248px video cards, 14px card gaps,
 * and 4-row track columns capped at min(88%, 400px).
 */

export type ShelfKind = 'editorial' | 'square' | 'tracks' | 'horizontal' | 'video' | 'circle';

export const shelfSection = 'pt-[26px]';

export const shelfHeader =
  'mx-(--bc-page-gutter) mb-2.5 flex min-h-[22px] items-center justify-between gap-3';

export const shelfList = [
  'grid grid-flow-col grid-rows-[repeat(var(--rows),max-content)] auto-cols-(--xs-width) gap-x-(--gap,14px) gap-y-(--row-gap)',
  '-my-[10px] px-(--bc-page-gutter) py-[10px] scroll-px-(--bc-page-gutter)',
  'overflow-x-auto overflow-y-hidden overscroll-x-none snap-x snap-mandatory scroll-smooth motion-reduce:scroll-auto',
  '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden *:min-w-0 *:snap-start',
  'lg:auto-cols-(--lg-width,var(--xs-width))',
].join(' ');

export const shelfKinds: Record<ShelfKind, string> = {
  editorial: '[--rows:1] [--row-gap:16px] [--gap:14px] [--xs-width:298px]',
  square: '[--rows:1] [--row-gap:16px] [--gap:14px] [--xs-width:var(--bc-shelf-card-w)]',
  tracks:
    '[--rows:4] [--row-gap:0px] [--gap:12px] [--xs-width:min(88%,var(--bc-track-column-max))] [--lg-width:min(44%,var(--bc-track-column-max))]',
  horizontal: '[--rows:2] [--row-gap:16px] [--gap:14px] [--xs-width:298px]',
  video: '[--rows:1] [--row-gap:16px] [--gap:14px] [--xs-width:248px]',
  circle: '[--rows:1] [--row-gap:16px] [--gap:14px] [--xs-width:132px]',
};
