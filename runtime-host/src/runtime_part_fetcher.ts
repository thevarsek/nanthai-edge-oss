import type { DeviceCredential } from "./control_plane.ts";
import {
  HttpJsonClient,
  type FetchImplementation,
} from "./http_json_client.ts";
import type { RuntimeContentPart } from "./protocol.ts";

type RuntimeFetchHandle = Exclude<RuntimeContentPart, { type: "text" }>["fetch"];

export type RuntimePartChunkRequest = {
  fetch: RuntimeFetchHandle;
  mimeType: string;
  offset: number;
  maxBytes: number;
};

export interface RuntimePartFetcher {
  fetchChunk(request: RuntimePartChunkRequest, signal: AbortSignal): Promise<Uint8Array>;
}

export type HttpRuntimePartFetcherOptions = {
  fetch?: FetchImplementation;
  presenceSessionId: string;
};

export class HttpRuntimePartFetcher implements RuntimePartFetcher {
  private readonly client: HttpJsonClient;

  constructor(
    private readonly credential: DeviceCredential,
    private readonly options: HttpRuntimePartFetcherOptions,
  ) {
    this.client = new HttpJsonClient(credential.controlPlaneUrl, {
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  }

  async fetchChunk(
    request: RuntimePartChunkRequest,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    validateChunkRequest(request);
    const response = await this.client.postBytes(
      "/runtime-host/v1/attachments/fetch",
      {
        handle: request.fetch.handle,
        offset: request.offset,
        maxBytes: request.maxBytes,
      },
      this.authHeaders(),
      signal,
    );
    validateChunkResponse(response, request);
    return response.bytes;
  }

  private authHeaders(): Readonly<Record<string, string>> {
    return {
      Authorization: `Bearer ${this.credential.credential}`,
      "X-NanthAI-Device-ID": this.credential.deviceId,
      "X-NanthAI-Credential-ID": this.credential.credentialId,
      "X-NanthAI-Presence-Session-ID": this.options.presenceSessionId,
    };
  }
}

function validateChunkRequest(request: RuntimePartChunkRequest): void {
  const remaining = request.fetch.byteLength - request.offset;
  if (!Number.isSafeInteger(request.offset) || request.offset < 0 || remaining <= 0
    || !Number.isSafeInteger(request.maxBytes) || request.maxBytes <= 0
    || request.maxBytes > request.fetch.maxChunkBytes || request.maxBytes > remaining) {
    throw new Error("Attachment fetch request exceeds its canonical range");
  }
}

function validateChunkResponse(
  response: { bytes: Uint8Array; headers: Headers; status: number },
  request: RuntimePartChunkRequest,
): void {
  if (response.status !== 206) throw new Error("Attachment fetch did not return a partial response");
  if (response.bytes.byteLength === 0 || response.bytes.byteLength > request.maxBytes) {
    throw new Error("Attachment fetch response exceeded its requested range");
  }
  const length = integerHeader(response.headers, "Content-Length");
  const offset = integerHeader(response.headers, "X-NanthAI-Attachment-Offset");
  const total = integerHeader(response.headers, "X-NanthAI-Attachment-Byte-Length");
  const expiresAt = integerHeader(response.headers, "X-NanthAI-Attachment-Expires-At");
  if (length !== response.bytes.byteLength || offset !== request.offset
    || total !== request.fetch.byteLength || expiresAt !== request.fetch.expiresAt) {
    throw new Error("Attachment fetch response metadata does not match its canonical handle");
  }
  const end = request.offset + response.bytes.byteLength - 1;
  if (response.headers.get("Content-Range") !== `bytes ${request.offset}-${end}/${total}`
    || response.headers.get("Accept-Ranges") !== "bytes"
    || response.headers.get("Cache-Control") !== "no-store") {
    throw new Error("Attachment fetch response range metadata is invalid");
  }
  const sha256 = response.headers.get("X-NanthAI-Attachment-SHA256");
  const etag = response.headers.get("ETag")?.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
  if (sha256 !== request.fetch.sha256 || etag !== request.fetch.sha256) {
    throw new Error("Attachment fetch response SHA-256 does not match its canonical handle");
  }
  const mimeType = response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mimeType !== request.mimeType.toLowerCase()) {
    throw new Error("Attachment fetch response MIME type does not match its canonical part");
  }
}

function integerHeader(headers: Headers, name: string): number {
  const raw = headers.get(name);
  if (raw === null || !/^\d+$/.test(raw)) throw new Error(`Attachment fetch omitted ${name}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`Attachment fetch returned invalid ${name}`);
  return value;
}
