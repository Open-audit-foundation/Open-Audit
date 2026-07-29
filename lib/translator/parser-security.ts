/**
 * Security Hardening Module for XDR/ScVal Parser
 *
 * This module implements defense mechanisms against malicious XDR payloads:
 * 1. Recursion depth tracking to prevent stack overflow attacks
 * 2. Memory allocation guards to prevent OOM attacks
 * 3. Parsing time limits to prevent infinite loop attacks
 * 4. Safe error handling with descriptive messages
 *
 * All parsing operations should go through these guards to ensure
 * the system remains resilient against "poisoned" contracts.
 */

// ============================================================================
// Configuration Constants
// ============================================================================

/**
 * Maximum allowed nesting depth for XDR structures.
 * Prevents stack overflow from deeply nested Maps, Vecs, or Structs.
 *
 * Typical legitimate contracts have depth < 10.
 * Setting to 100 provides generous headroom while blocking attacks.
 */
export const MAX_RECURSION_DEPTH = 100;

/**
 * Maximum allowed memory allocation for a single XDR payload (bytes).
 * Prevents OOM attacks from payloads that claim huge sizes.
 *
 * 10MB is generous for any legitimate contract event.
 */
export const MAX_PAYLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Maximum parsing time allowed per XDR payload (milliseconds).
 * Prevents infinite loop attacks or extremely slow parsing.
 *
 * 5 seconds should be more than enough for any legitimate payload.
 */
export const MAX_PARSE_TIME_MS = 5000;

/**
 * Maximum length for a single hex string before parsing.
 * Prevents attempting to parse absurdly large hex strings.
 *
 * 2MB hex string = 1MB binary data, which is already very large.
 */
export const MAX_HEX_STRING_LENGTH = 2 * 1024 * 1024 * 2; // 2 MB * 2 chars per byte

/**
 * Maximum number of elements in a Vec or Map.
 * Prevents attacks that create extremely large collections.
 */
export const MAX_COLLECTION_SIZE = 10000;

// ============================================================================
// Custom Error Classes
// ============================================================================

/**
 * Base class for parser security errors.
 * All security-related errors extend this for easy filtering.
 */
export class ParserSecurityError extends Error {
  constructor(message: string, public readonly errorType: string) {
    super(message);
    this.name = "ParserSecurityError";
  }
}

/**
 * Thrown when parsing exceeds maximum recursion depth.
 * Indicates a potentially malicious deeply-nested payload.
 */
export class MaxDepthExceededError extends ParserSecurityError {
  constructor(depth: number, maxDepth: number) {
    super(
      `Maximum recursion depth exceeded: ${depth} > ${maxDepth}. ` +
      `This payload may be maliciously crafted to cause stack overflow.`,
      "MAX_DEPTH_EXCEEDED"
    );
    this.name = "MaxDepthExceededError";
  }
}

/**
 * Thrown when a payload exceeds maximum allowed size.
 * Indicates a potentially malicious payload designed to cause OOM.
 */
export class MaxPayloadSizeExceededError extends ParserSecurityError {
  constructor(size: number, maxSize: number) {
    super(
      `Payload size exceeded: ${size} bytes > ${maxSize} bytes. ` +
      `This payload may be maliciously crafted to cause out-of-memory errors.`,
      "MAX_PAYLOAD_SIZE_EXCEEDED"
    );
    this.name = "MaxPayloadSizeExceededError";
  }
}

/**
 * Thrown when parsing takes longer than allowed.
 * Indicates a potentially malicious payload designed to cause DoS.
 */
export class MaxParseTimeExceededError extends ParserSecurityError {
  constructor(elapsed: number, maxTime: number) {
    super(
      `Parsing time exceeded: ${elapsed}ms > ${maxTime}ms. ` +
      `This payload may be maliciously crafted to cause infinite loops or excessive CPU usage.`,
      "MAX_PARSE_TIME_EXCEEDED"
    );
    this.name = "MaxParseTimeExceededError";
  }
}

/**
 * Thrown when a collection exceeds maximum allowed size.
 * Indicates a potentially malicious payload with extremely large arrays/maps.
 */
export class MaxCollectionSizeExceededError extends ParserSecurityError {
  constructor(size: number, maxSize: number) {
    super(
      `Collection size exceeded: ${size} elements > ${maxSize} elements. ` +
      `This payload may be maliciously crafted to cause excessive memory usage.`,
      "MAX_COLLECTION_SIZE_EXCEEDED"
    );
    this.name = "MaxCollectionSizeExceededError";
  }
}

/**
 * Thrown when a hex string is too long.
 * Indicates a potentially malicious payload.
 */
export class MaxHexLengthExceededError extends ParserSecurityError {
  constructor(length: number, maxLength: number) {
    super(
      `Hex string length exceeded: ${length} chars > ${maxLength} chars. ` +
      `This payload may be maliciously crafted.`,
      "MAX_HEX_LENGTH_EXCEEDED"
    );
    this.name = "MaxHexLengthExceededError";
  }
}

/**
 * Thrown when an invalid or malformed XDR structure is detected.
 */
export class MalformedXdrError extends ParserSecurityError {
  constructor(message: string) {
    super(
      `Malformed XDR structure detected: ${message}. ` +
      `This payload may be corrupted or maliciously crafted.`,
      "MALFORMED_XDR"
    );
    this.name = "MalformedXdrError";
  }
}

// ============================================================================
// Security Context
// ============================================================================

/**
 * Parsing context that tracks security metrics during parsing.
 * Passed through the recursive parsing chain to enforce limits.
 */
export interface ParsingContext {
  /** Current recursion depth. */
  currentDepth: number;
  /** Maximum allowed depth. */
  maxDepth: number;
  /** Start time of parsing (for timeout detection). */
  startTime: number;
  /** Maximum allowed parsing time (milliseconds). */
  maxParseTime: number;
  /** Total bytes allocated so far. */
  allocatedBytes: number;
  /** Maximum allowed allocation. */
  maxAllocation: number;
}

/**
 * Creates a new parsing context with default security settings.
 */
export function createParsingContext(): ParsingContext {
  return {
    currentDepth: 0,
    maxDepth: MAX_RECURSION_DEPTH,
    startTime: Date.now(),
    maxParseTime: MAX_PARSE_TIME_MS,
    allocatedBytes: 0,
    maxAllocation: MAX_PAYLOAD_SIZE_BYTES,
  };
}

/**
 * Creates a child context with incremented depth.
 * Throws MaxDepthExceededError if depth limit is reached.
 */
export function enterLevel(ctx: ParsingContext): ParsingContext {
  const newDepth = ctx.currentDepth + 1;
  
  if (newDepth > ctx.maxDepth) {
    throw new MaxDepthExceededError(newDepth, ctx.maxDepth);
  }
  
  return {
    ...ctx,
    currentDepth: newDepth,
  };
}

/**
 * Checks if parsing time has exceeded the limit.
 * Throws MaxParseTimeExceededError if timeout is reached.
 */
export function checkTimeout(ctx: ParsingContext): void {
  const elapsed = Date.now() - ctx.startTime;
  
  if (elapsed > ctx.maxParseTime) {
    throw new MaxParseTimeExceededError(elapsed, ctx.maxParseTime);
  }
}

/**
 * Tracks memory allocation and throws if limit is exceeded.
 * Call this before allocating buffers, arrays, or objects.
 */
export function trackAllocation(ctx: ParsingContext, bytes: number): ParsingContext {
  const newTotal = ctx.allocatedBytes + bytes;
  
  if (newTotal > ctx.maxAllocation) {
    throw new MaxPayloadSizeExceededError(newTotal, ctx.maxAllocation);
  }
  
  return {
    ...ctx,
    allocatedBytes: newTotal,
  };
}

/**
 * Validates collection size before processing.
 * Throws MaxCollectionSizeExceededError if too large.
 */
export function validateCollectionSize(size: number): void {
  if (size > MAX_COLLECTION_SIZE) {
    throw new MaxCollectionSizeExceededError(size, MAX_COLLECTION_SIZE);
  }
}

/**
 * Validates hex string length before parsing.
 * Throws MaxHexLengthExceededError if too long.
 */
export function validateHexLength(hex: string): void {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  
  if (cleanHex.length > MAX_HEX_STRING_LENGTH) {
    throw new MaxHexLengthExceededError(cleanHex.length, MAX_HEX_STRING_LENGTH);
  }
}

// ============================================================================
// Safe Parsing Wrapper
// ============================================================================

/**
 * Result of a safe parsing operation.
 * Either success with value, or failure with error.
 */
export type SafeParseResult<T> =
  | { success: true; value: T; error: null }
  | { success: false; value: null; error: ParserSecurityError };

/**
 * Wraps a parsing function with comprehensive security checks.
 * Catches all security errors and returns a safe result.
 *
 * This is the main entry point for all XDR parsing operations.
 *
 * @param fn The parsing function to execute
 * @param ctx Optional parsing context (creates default if not provided)
 * @returns SafeParseResult with either the parsed value or error
 */
export function safeParseXdr<T>(
  fn: (ctx: ParsingContext) => T,
  ctx?: ParsingContext
): SafeParseResult<T> {
  const context = ctx ?? createParsingContext();
  
  try {
    // Check timeout before starting
    checkTimeout(context);
    
    // Execute the parsing function
    const value = fn(context);
    
    // Success!
    return { success: true, value, error: null };
    
  } catch (error) {
    // Convert to ParserSecurityError if not already
    if (error instanceof ParserSecurityError) {
      return { success: false, value: null, error };
    }
    
    // Wrap unknown errors as MalformedXdrError
    const message = error instanceof Error ? error.message : String(error);
    const securityError = new MalformedXdrError(message);
    
    return { success: false, value: null, error: securityError };
  }
}

// ============================================================================
// Metrics & Monitoring
// ============================================================================

/**
 * Security metrics for monitoring parser behavior.
 * Useful for detecting attack patterns and tuning limits.
 */
export interface SecurityMetrics {
  /** Total number of parsing attempts. */
  totalParses: number;
  /** Number of successful parses. */
  successfulParses: number;
  /** Number of security errors by type. */
  errorsByType: Record<string, number>;
  /** Maximum depth reached. */
  maxDepthReached: number;
  /** Maximum payload size seen. */
  maxPayloadSizeSeen: number;
  /** Maximum parse time seen (milliseconds). */
  maxParseTimeSeen: number;
  /** Number of parses rejected (security errors). */
  rejectedParses: number;
}

/**
 * Global security metrics (singleton).
 */
const metrics: SecurityMetrics = {
  totalParses: 0,
  successfulParses: 0,
  errorsByType: {},
  maxDepthReached: 0,
  maxPayloadSizeSeen: 0,
  maxParseTimeSeen: 0,
  rejectedParses: 0,
};

/**
 * Records a parsing attempt in the metrics.
 */
export function recordParse(
  success: boolean,
  ctx: ParsingContext,
  error?: ParserSecurityError
): void {
  metrics.totalParses++;
  
  if (success) {
    metrics.successfulParses++;
  } else {
    metrics.rejectedParses++;
    
    if (error) {
      metrics.errorsByType[error.errorType] =
        (metrics.errorsByType[error.errorType] ?? 0) + 1;
    }
  }
  
  // Update max values seen
  metrics.maxDepthReached = Math.max(metrics.maxDepthReached, ctx.currentDepth);
  metrics.maxPayloadSizeSeen = Math.max(metrics.maxPayloadSizeSeen, ctx.allocatedBytes);
  
  const elapsed = Date.now() - ctx.startTime;
  metrics.maxParseTimeSeen = Math.max(metrics.maxParseTimeSeen, elapsed);
}

/**
 * Returns a snapshot of current security metrics.
 */
export function getSecurityMetrics(): SecurityMetrics {
  return { ...metrics, errorsByType: { ...metrics.errorsByType } };
}

/**
 * Resets security metrics (useful for testing).
 */
export function resetSecurityMetrics(): void {
  metrics.totalParses = 0;
  metrics.successfulParses = 0;
  metrics.errorsByType = {};
  metrics.maxDepthReached = 0;
  metrics.maxPayloadSizeSeen = 0;
  metrics.maxParseTimeSeen = 0;
  metrics.rejectedParses = 0;
}

/**
 * Returns true if security metrics indicate an attack pattern.
 * Useful for automated alerting.
 */
export function detectAttackPattern(): boolean {
  const { totalParses, rejectedParses } = metrics;
  
  // If we haven't seen many parses yet, don't trigger
  if (totalParses < 100) return false;
  
  // If more than 10% of parses are rejected, possible attack
  const rejectionRate = rejectedParses / totalParses;
  if (rejectionRate > 0.1) return true;
  
  // If we're seeing repeated depth errors, possible attack
  const depthErrors = metrics.errorsByType["MAX_DEPTH_EXCEEDED"] ?? 0;
  if (depthErrors > 10) return true;
  
  // If we're seeing repeated size errors, possible attack
  const sizeErrors = metrics.errorsByType["MAX_PAYLOAD_SIZE_EXCEEDED"] ?? 0;
  if (sizeErrors > 10) return true;
  
  return false;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Logs a security error with context.
 * Use this for centralized security event logging.
 */
export function logSecurityError(error: ParserSecurityError, context?: unknown): void {
  console.error("[SECURITY] XDR Parser Security Error:", {
    type: error.errorType,
    message: error.message,
    name: error.name,
    context,
    timestamp: new Date().toISOString(),
  });
  
  // In production, this should also send to your monitoring/alerting system
  // e.g., Sentry, DataDog, CloudWatch, etc.
}

/**
 * Returns true if the error is a security-related error.
 * Useful for error handling and logging.
 */
export function isSecurityError(error: unknown): error is ParserSecurityError {
  return error instanceof ParserSecurityError;
}

/**
 * Converts a security error to a safe, user-friendly message.
 * Hides technical details but keeps useful information.
 */
export function toSafeErrorMessage(error: ParserSecurityError): string {
  switch (error.errorType) {
    case "MAX_DEPTH_EXCEEDED":
      return "This event contains deeply nested data that cannot be safely parsed.";
    
    case "MAX_PAYLOAD_SIZE_EXCEEDED":
      return "This event payload is too large to be safely parsed.";
    
    case "MAX_PARSE_TIME_EXCEEDED":
      return "This event took too long to parse and was rejected for safety.";
    
    case "MAX_COLLECTION_SIZE_EXCEEDED":
      return "This event contains too many elements to be safely parsed.";
    
    case "MAX_HEX_LENGTH_EXCEEDED":
      return "This event data is too long to be safely parsed.";
    
    case "MALFORMED_XDR":
      return "This event contains malformed or corrupted data.";
    
    default:
      return "This event could not be safely parsed due to security restrictions.";
  }
}
