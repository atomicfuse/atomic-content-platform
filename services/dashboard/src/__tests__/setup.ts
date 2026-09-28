import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

/**
 * Global `next/navigation` mock. Components that call `useRouter()` outside
 * an App Router context (e.g. rendered standalone in a component test) get
 * a real Next.js invariant throw otherwise — see SiteThemeTab.tsx, which
 * calls `useRouter()` unconditionally. A per-test-file `vi.mock("next/navigation", ...)`
 * (e.g. SiteThemeTab.refresh.test.tsx, which needs to spy on `refresh`)
 * takes precedence over this one for that file.
 *
 * Before adding this, every existing test file was grepped for
 * `next/navigation` usage and every component under test was grepped for
 * `useRouter`/`usePathname`/`useSearchParams`/`useParams` — as of this
 * writing, no existing test file relies on real `next/navigation` behavior,
 * so this global stub can't change any current test's outcome.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
