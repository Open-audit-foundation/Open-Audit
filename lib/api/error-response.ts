import { NextResponse } from "next/server";
import {
  isOpenAuditError,
  normalizeError,
  OpenAuditError,
  type ErrorCode,
  type ErrorContext,
} from "@/lib/errors";

export interface ApiErrorBody {
  error: string;
  code: ErrorCode;
  message: string;
  context: ErrorContext;
}

export interface ValidationErrorBody {
  error: string;
  code: "VALIDATION_ERROR";
  message: string;
}

/** Builds a structured 4xx validation response without telemetry noise. */
export function validationErrorResponse(message: string, status = 400): NextResponse<ValidationErrorBody> {
  return NextResponse.json(
    {
      error: message,
      code: "VALIDATION_ERROR",
      message,
    },
    { status }
  );
}

/** Maps a domain exception to a structured JSON error response and reports it. */
export function toErrorResponse(
  error: unknown,
  options: {
    fallbackMessage?: string;
    status?: number;
    context?: ErrorContext;
  } = {}
): NextResponse<ApiErrorBody> {
  const normalized = isOpenAuditError(error)
    ? error
    : normalizeError(error, options.fallbackMessage ?? "Internal server error", options.context ?? {});

  console.error('[error-response.ts] Error:', normalized);

  const status =
    options.status ??
    (normalized.code === "STELLAR_NETWORK_ERROR"
      ? 502
      : normalized.code === "VALIDATION_ERROR" || normalized.code === "REGISTRY_TEMPLATE_ERROR"
        ? 400
        : normalized.code === "XDR_PARSING_ERROR"
          ? 422
          : 500);

  return NextResponse.json(
    {
      error: normalized.message,
      code: normalized.code,
      message: normalized.message,
      context: normalized.context,
    },
    { status }
  );
}

/** Re-export for callers that need the normalized error without building a response. */
export { OpenAuditError, isOpenAuditError, normalizeError };
