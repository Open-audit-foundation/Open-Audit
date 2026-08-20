// prom-client ships type declarations only for its package root (`prom-client`).
// lib/metrics.ts imports Counter/Gauge/Registry from their submodule paths
// directly (bypassing the root barrel, which pulls in Node-only built-ins via
// defaultMetrics/cluster) — these declarations re-point those deep import
// paths at the same public types.
declare module "prom-client/lib/counter" {
  import { Counter } from "prom-client";
  export default Counter;
}

declare module "prom-client/lib/gauge" {
  import { Gauge } from "prom-client";
  export default Gauge;
}

declare module "prom-client/lib/registry" {
  import { Registry } from "prom-client";
  export default Registry;
}
