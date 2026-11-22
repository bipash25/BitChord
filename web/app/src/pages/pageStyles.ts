/** Styles shared across inner pages (`Common.kt:221-257`, spec §2.5 & §6.8). */

export const detailFooter =
  'mx-(--bc-page-gutter) mt-8 pb-10 bc-type-body text-(--bc-page-on-variant,var(--bc-on-surface-variant))';

/**
 * Library / Browse grids (`Common.kt:221-229`): 140px minimum card, 12px gaps,
 * 2–5 columns (4 columns max for 16:9 wide video cards).
 */
export const seeAllGrid =
  'mx-(--bc-page-gutter) mt-4 mb-10 grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 min-[980px]:grid-cols-5 data-wide:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] min-[1260px]:data-wide:grid-cols-4';

export const seeAllTracks = 'pt-3';
