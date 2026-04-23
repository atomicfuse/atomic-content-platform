/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

interface Env {
  ASSETS: Fetcher;
}

declare namespace App {
  interface Locals extends Runtime {}
}
