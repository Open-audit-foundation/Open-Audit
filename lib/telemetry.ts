import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";
import { context, diag, DiagConsoleLogger, DiagLogLevel, trace } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { JaegerExporter } from "@opentelemetry/exporter-jaeger";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";

export const metricsRegistry = new Registry();

collectDefaultMetrics({
  register: metricsRegistry,
  prefix: "open_audit_",
  timeout: 5000,
});

export const eventsIngestedTotal = new Counter({
  name: "open_audit_events_ingested_total",
  help: "Number of events ingested by contract and status.",
  labelNames: ["contract_id", "status"] as const,
  registers: [metricsRegistry],
});

export const rpcRequestDurationSeconds = new Histogram({
  name: "open_audit_rpc_request_duration_seconds",
  help: "Duration of Stellar RPC getEvents requests in seconds.",
  labelNames: ["contract_id"] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});

export const translationProcessingMs = new Histogram({
  name: "open_audit_translation_processing_ms",
  help: "Translation processing time in milliseconds per contract.",
  labelNames: ["contract_id"] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2000],
  registers: [metricsRegistry],
});

const jaegerEndpoint = process.env.JAEGER_ENDPOINT ?? "http://localhost:14268/api/traces";
const serviceName = process.env.OTEL_SERVICE_NAME ?? "open-audit";

const sdk = new NodeSDK({
  traceExporter: new JaegerExporter({
    endpoint: jaegerEndpoint,
    serviceName,
  }),
  instrumentations: [new HttpInstrumentation()],
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
  }),
});

export const tracer = trace.getTracer("open-audit");

export async function startTelemetry(): Promise<void> {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  await sdk.start();
  console.log(`[telemetry] OpenTelemetry initialized (Jaeger endpoint=${jaegerEndpoint})`);
}

export async function shutdownTelemetry(): Promise<void> {
  await sdk.shutdown();
  console.log("[telemetry] OpenTelemetry shutdown complete");
}

export function captureExceptionSync(error: Error, options?: { context?: Record<string, unknown> }): void {
  const contextInfo = options?.context ? ` | context=${JSON.stringify(options.context)}` : "";
  diag.error(`Captured exception: ${error.message}${contextInfo}`);
  console.error("[telemetry] Captured exception:", error, options?.context ?? "");
}

export async function metricsHandler(res: import("http").ServerResponse): Promise<void> {
  try {
    const metrics = await metricsRegistry.metrics();
    res.writeHead(200, {
      "Content-Type": metricsRegistry.contentType,
      "Cache-Control": "no-cache, no-store, must-revalidate",
    });
    res.end(metrics);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Unable to collect metrics: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function traceRpcRequest<T>(contractId: string, fn: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(
    "open_audit_rpc_request",
    { attributes: { contract_id: contractId } },
    async (span) => {
      const start = Date.now();
      try {
        return await fn();
      } catch (error) {
        span.recordException(error);
        throw error;
      } finally {
        span.end();
        rpcRequestDurationSeconds.labels(contractId).observe((Date.now() - start) / 1000);
      }
    }
  );
}

export function traceSyncSpan<T>(name: string, attributes: Record<string, string>, fn: () => T): T {
  const span = tracer.startSpan(name, { attributes });
  try {
    return fn();
  } catch (error) {
    span.recordException(error);
    throw error;
  } finally {
    span.end();
  }
}

export function recordTranslationDuration<T>(contractId: string, fn: () => T): T {
  const start = Date.now();
  try {
    return fn();
  } finally {
    translationProcessingMs.labels(contractId).observe(Date.now() - start);
  }
}
