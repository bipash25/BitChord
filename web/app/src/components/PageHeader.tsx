
/** The page title row; below 1000px aligns to Android's 16px gutter and 12px top-bar gap. */
export function PageHeader({ title }: { title: string }) {
  return (
    <div className="mx-(--body-gutter) pt-8 max-lg:mx-(--bc-page-gutter) max-lg:pt-(--bc-topbar-gap)">
      <h1 className="type-header-emphasized max-lg:font-(family-name:--bc-font-family) max-lg:text-[34px] max-lg:leading-[1.15] max-lg:font-extrabold max-lg:tracking-(--bc-tracking-display)">
        {title}
      </h1>
    </div>
  );
}
