/**
 * Canonical site configuration shared by the `app/robots.ts` and
 * `app/sitemap.ts` metadata routes (see Next.js Metadata Files:
 * https://nextjs.org/docs/app/api-reference/file-conventions/metadata).
 */

/**
 * Base URL the app is served from. Must be set to the production origin
 * (e.g. `https://open-audit.example.com`) via `NEXT_PUBLIC_SITE_URL` for
 * the sitemap to advertise correct absolute URLs; falls back to localhost
 * for local development.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(
  /\/+$/,
  "",
);

/**
 * Public, unauthenticated routes that should be discoverable by search
 * engines. Deliberately excludes `/api/*` and any auth-gated routes.
 */
export const PUBLIC_ROUTES: ReadonlyArray<{
  path: string;
  changeFrequency: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority: number;
}> = [
  { path: "/", changeFrequency: "daily", priority: 1 },
  { path: "/dashboard", changeFrequency: "hourly", priority: 0.9 },
  { path: "/dag", changeFrequency: "hourly", priority: 0.8 },
  { path: "/graph", changeFrequency: "hourly", priority: 0.8 },
  { path: "/docs", changeFrequency: "weekly", priority: 0.7 },
  { path: "/developer/sandbox", changeFrequency: "weekly", priority: 0.6 },
  { path: "/status", changeFrequency: "hourly", priority: 0.5 },
];
