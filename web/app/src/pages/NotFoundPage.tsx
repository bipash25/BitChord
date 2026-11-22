import { PageHeader } from '@/components/PageHeader';
import { PrefetchLink } from '@/components/PrefetchLink';

export default function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" />
      <p className="mx-(--bc-page-gutter) my-3 bc-type-body-lg text-(--bc-on-surface-variant)">
        This page doesn’t exist.{' '}
        <PrefetchLink to="/home" className="font-semibold text-(--bc-primary) hover:underline">
          Go to Home
        </PrefetchLink>
      </p>
    </>
  );
}
