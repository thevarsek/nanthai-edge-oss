import {
  ConvexError,
} from "convex/values";
import {
  makeFunctionReference,
  type DefaultFunctionArgs,
  type FunctionReference,
} from "convex/server";
import { ZodError, type ZodType } from "zod";

export type RuntimeHostHeaders = {
  deviceId: string;
  credentialId: string;
  credential: string;
  presenceSessionId: string;
};

export function publicRef<
  Kind extends "query" | "mutation",
  Args extends DefaultFunctionArgs,
  Result,
>(name: string): FunctionReference<Kind, "public", Args, Result> {
  return makeFunctionReference<Kind, Args, Result>(name) as unknown as FunctionReference<
    Kind,
    "public",
    Args,
    Result
  >;
}

export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new HttpRuntimeError("VALIDATION_ERROR", "Request body must be valid JSON", 400);
  }
  return schema.parse(value);
}

export function runtimeDeviceHeaders(request: Request, requirePresence = false): Omit<RuntimeHostHeaders, "presenceSessionId"> {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("Authorization") ?? "");
  const deviceId = request.headers.get("X-NanthAI-Device-ID")?.trim();
  const credentialId = request.headers.get("X-NanthAI-Credential-ID")?.trim();
  if (!match?.[1] || !deviceId || !credentialId) {
    throw new HttpRuntimeError("UNAUTHORIZED", requirePresence ? "Runtime Host credential and presence headers are required" : "Runtime Host credential headers are required", 401);
  }
  return { deviceId, credentialId, credential: match[1].trim() };
}

export function runtimeHostHeaders(request: Request): RuntimeHostHeaders {
  const device = runtimeDeviceHeaders(request, true);
  const presenceSessionId = request.headers.get("X-NanthAI-Presence-Session-ID")?.trim();
  if (!presenceSessionId) {
    throw new HttpRuntimeError("UNAUTHORIZED", "Runtime Host credential and presence headers are required", 401);
  }
  return { ...device, presenceSessionId };
}

export function withRuntimeHttpErrors(
  handler: () => Promise<Response>,
): Promise<Response> {
  return handler().catch((error: unknown) => runtimeHttpErrorResponse(error));
}

export function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

class HttpRuntimeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    message: string,
    status: number,
  ) {
    super(message);
    this.name = "HttpRuntimeError";
    this.code = code;
    this.status = status;
  }
}

function runtimeHttpErrorResponse(error: unknown): Response {
  if (error instanceof HttpRuntimeError) {
    return errorEnvelope(error.code, error.message, error.status);
  }
  if (error instanceof ZodError) {
    return errorEnvelope("VALIDATION_ERROR", "Request payload is invalid", 400);
  }
  const data = convexErrorData(error);
  if (data) return errorEnvelope(data.code, data.message, statusForCode(data.code));
  return errorEnvelope("INTERNAL_ERROR", "Runtime Host request failed", 500);
}

function convexErrorData(error: unknown): { code: string; message: string } | null {
  const data = error instanceof ConvexError
    ? error.data
    : typeof error === "object" && error !== null && "data" in error
      ? (error as { data?: unknown }).data
      : null;
  if (typeof data !== "object" || data === null) return null;
  const code = "code" in data ? data.code : null;
  const message = "message" in data ? data.message : null;
  return typeof code === "string" && typeof message === "string"
    ? { code, message }
    : null;
}

function statusForCode(code: string): number {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "NOT_FOUND" || code === "PAIRING_INVALID") return 404;
  if (code === "PAIRING_EXPIRED") return 410;
  if (code === "RUNTIME_HOST_OFFLINE" || code === "RUNTIME_UNAVAILABLE") return 503;
  if (code === "CONFLICT" || code.includes("CONFLICT")) return 409;
  if (code === "VALIDATION_ERROR" || code.includes("REQUIRED")) return 400;
  return 400;
}

function errorEnvelope(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status);
}
