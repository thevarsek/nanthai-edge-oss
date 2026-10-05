import { z } from "zod";

export type FetchImplementation = typeof fetch;

export class RuntimeHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeHttpError";
  }
}

export type HttpJsonClientOptions = {
  fetch?: FetchImplementation;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

export class HttpJsonClient {
  private readonly fetchImplementation: FetchImplementation;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(
    private readonly baseUrl: string,
    options: HttpJsonClientOptions = {},
  ) {
    this.fetchImplementation = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 4 * 1024 * 1024;
  }

  async post<T>(
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
    headers: Readonly<Record<string, string>> = {},
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: combinedSignal(signal, this.timeoutMs),
    });
    return schema.parse(await this.readJson(response));
  }

  async getBytes(
    path: string,
    headers: Readonly<Record<string, string>> = {},
    signal?: AbortSignal,
  ): Promise<{ bytes: Uint8Array; headers: Headers; status: number }> {
    const response = await this.request(path, {
      method: "GET",
      headers,
      signal: combinedSignal(signal, this.timeoutMs),
    });
    return await this.readBytes(response);
  }

  async postBytes(
    path: string,
    body: unknown,
    headers: Readonly<Record<string, string>> = {},
    signal?: AbortSignal,
  ): Promise<{ bytes: Uint8Array; headers: Headers; status: number }> {
    const response = await this.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: combinedSignal(signal, this.timeoutMs),
    });
    return await this.readBytes(response);
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImplementation(new URL(path, normalizedBase(this.baseUrl)), init);
    } catch (error) {
      throw new RuntimeHttpError(0, "NETWORK_ERROR", publicNetworkError(error));
    }
    if (response.ok) return response;
    throw await this.errorResponse(response);
  }

  private async readJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > this.maxResponseBytes) {
      throw new RuntimeHttpError(502, "RESPONSE_TOO_LARGE", "Runtime response exceeded its bound");
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new RuntimeHttpError(502, "INVALID_JSON", "Runtime endpoint returned invalid JSON");
    }
  }

  private async readBytes(
    response: Response,
  ): Promise<{ bytes: Uint8Array; headers: Headers; status: number }> {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > this.maxResponseBytes) {
      throw new RuntimeHttpError(502, "RESPONSE_TOO_LARGE", "Runtime response exceeded its bound");
    }
    return { bytes, headers: response.headers, status: response.status };
  }

  private async errorResponse(response: Response): Promise<RuntimeHttpError> {
    let body: unknown = null;
    try {
      body = await this.readJson(response);
    } catch {
      return new RuntimeHttpError(response.status, "HTTP_ERROR", `Runtime endpoint failed (${response.status})`);
    }
    const parsed = ErrorResponseSchema.safeParse(body);
    return parsed.success
      ? new RuntimeHttpError(response.status, parsed.data.code, parsed.data.message)
      : new RuntimeHttpError(response.status, "HTTP_ERROR", `Runtime endpoint failed (${response.status})`);
  }
}

const ErrorResponseSchema = z.union([
  z.object({ code: z.string().min(1), message: z.string().min(1) }),
  z.object({ error: z.object({ code: z.string().min(1), message: z.string().min(1) }) })
    .transform((value) => value.error),
]);

function normalizedBase(value: string): URL {
  const url = new URL(value);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

function publicNetworkError(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "Runtime endpoint request was cancelled or timed out";
  }
  return "Runtime endpoint could not be reached";
}
