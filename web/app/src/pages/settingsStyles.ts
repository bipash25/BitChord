/*
 * Android iOS-grouped settings cards (`SettingsSheet.kt:2346-2705`, spec §6.11):
 * 14px group cards on `--bc-surface-variant`, 16px inset, 52px min rows, 0.5px
 * hairlines inset to text, and 11px uppercase section headers.
 */

const row =
  'relative flex min-h-[52px] items-center justify-between px-4 py-3 bc-type-body-lg text-(--bc-on-surface) hairline-[16px]';
const integration =
  'relative grid min-h-[52px] items-center gap-x-3.5 px-4 py-3 bc-type-body-lg text-(--bc-on-surface) hairline-[52px]';
const field =
  'h-10 w-[220px] flex-none rounded-(--bc-radius-field) border-0 bg-(--bc-bg) px-3 font-(family-name:--bc-font-family) text-[15px] text-(--bc-on-surface) placeholder:text-(--bc-on-surface-variant)';

export const settingsUi = {
  centered: 'mx-auto max-w-[calc(640px+2*var(--bc-group-inset))]',
  body: 'mx-(--bc-group-inset) mt-3.5 mb-[120px] max-w-[640px]',
  group: 'overflow-hidden rounded-(--bc-radius-group) bg-(--bc-surface-variant)',
  sectionHeader: 'mx-1 mt-[26px] mb-2 bc-type-label-sm uppercase text-(--bc-on-surface-variant)',
  footer: 'mx-1 mt-2 bc-type-body text-(--bc-on-surface-variant)',

  row,
  controlRow: `${row} cursor-pointer gap-4`,
  rowText: 'flex flex-col gap-0.5',
  rowDetail: 'bc-type-body text-(--bc-on-surface-variant)',
  value: 'inline-flex items-center gap-1.5 text-right bc-type-body-lg text-(--bc-on-surface-variant)',

  integration: `${integration} grid-cols-[24px_minmax(0,1fr)_auto]`,
  integrationPlain: `${integration} grid-cols-[minmax(0,1fr)_auto]`,
  integrationIcon: 'grid size-6 place-items-center rounded-[6px] text-white',
  integrationName: 'min-w-0',
  linkRow: 'w-full cursor-pointer text-start hover:bg-(--bc-hover-fill)',
  inlineButton:
    'ml-2 rounded-full bg-(--bc-tab-pill-bg) px-3 py-1 bc-type-label text-(--bc-on-surface) hover:opacity-85 disabled:opacity-45',
  input: field,
};
