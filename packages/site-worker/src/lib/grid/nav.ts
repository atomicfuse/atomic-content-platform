import type { ResolvedGridTopic } from '@atomic-platform/shared-types';

/** One header pill. */
export interface NavPill {
  label: string;
  href: string;
  active: boolean;
}

/** "All" + one pill per configured topic, in config order. */
export function buildPills(topics: readonly ResolvedGridTopic[], activeTopic: string | null): NavPill[] {
  return [
    { label: 'All', href: '/', active: activeTopic === null },
    ...topics.map((t) => ({ label: t.label, href: `/topic/${t.slug}`, active: t.slug === activeTopic })),
  ];
}
