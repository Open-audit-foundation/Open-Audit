import type { ErrorCode, ErrorContext, StructuredErrorPayload } from "./types";

/**
 * Base class for all Open-Audit domain exceptions.
 * Carries a machine-readable code and contextual metadata for telemetry grouping.
 */
export class OpenAuditError extends Error {
  readonly code: ErrorCode;
  readonly context: ErrorContext;
  readonly cause?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    context: ErrorContext = {},
    cause?: unknown
  ) {
    super(message);
    this.name = "OpenAuditError";
    this.code = code;
    this.context = context;
    this.cause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Serializes the error for structured JSON responses and telemetry. */
  toJSON(): StructuredErrorPayload {
    return {
      code: this.code,
      message: this.message,
      context: this.context,
    };
  }

  /** Sentry-style fingerprint for grouping alerts by error type and contract. */
  fingerprint(): string[] {
    const parts: string[] = [this.code];
    if (this.context.contractId) {
      parts.push(this.context.contractId);
    }
    return parts;
  }
}
