import assert from "node:assert/strict";
import test from "node:test";

import { uploadDriveFile } from "../tools/google/drive_upload";
import { uploadOneDriveFile } from "../tools/microsoft/onedrive_upload";
import { readFixedSizeChunks } from "../tools/storage_upload_stream";

function responseStream(size: number): Response {
  const firstSize = Math.floor(size / 2);
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(firstSize));
      controller.enqueue(new Uint8Array(size - firstSize));
      controller.close();
    },
  }));
  response.arrayBuffer = async () => {
    throw new Error("resumable uploads must not buffer the full file");
  };
  return response;
}

test("readFixedSizeChunks emits bounded chunks and preserves every byte", async () => {
  const response = new Response(Uint8Array.from([1, 2, 3, 4, 5, 6, 7]));
  const chunks: number[][] = [];
  for await (const chunk of readFixedSizeChunks(response, 3)) {
    chunks.push([...chunk]);
  }
  assert.deepEqual(chunks, [[1, 2, 3], [4, 5, 6], [7]]);
});

test("Drive uses a resumable upload above 5 MB without reading the full body", async () => {
  const originalFetch = globalThis.fetch;
  const size = 5 * 1024 * 1024 + 1;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.includes("uploadType=resumable")) {
      return new Response(null, {
        status: 200,
        headers: { Location: "https://www.googleapis.com/upload/drive/v3/files/session_1" },
      });
    }
    if (url.endsWith("/session_1")) {
      return new Response(JSON.stringify({ id: "drive_1", name: "image.webp", mimeType: "image/webp" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const result = await uploadDriveFile({
      accessToken: "token",
      response: responseStream(size),
      sizeBytes: size,
      metadata: { name: "image.webp" },
      mimeType: "image/webp",
    });

    assert.equal(result.id, "drive_1");
    assert.equal(requests.some(({ url }) => url.includes("uploadType=multipart")), false);
    const upload = requests.find(({ url }) => url.endsWith("/session_1"));
    assert.ok(upload);
    assert.equal(
      (upload.init?.headers as Record<string, string>)["Content-Range"],
      `bytes 0-${size - 1}/${size}`,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Drive resends only the unacknowledged suffix after a partial 308 response", async () => {
  const originalFetch = globalThis.fetch;
  const chunkSize = 8 * 1024 * 1024;
  const partialSize = 4 * 1024 * 1024;
  const size = chunkSize + 1;
  const ranges: string[] = [];
  const bodySizes: number[] = [];
  let uploadCount = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("uploadType=resumable")) {
      return new Response(null, {
        status: 200,
        headers: { Location: "https://www.googleapis.com/upload/drive/v3/files/session_partial" },
      });
    }
    uploadCount += 1;
    ranges.push((init?.headers as Record<string, string>)["Content-Range"]);
    bodySizes.push((init?.body as Uint8Array).byteLength);
    if (uploadCount === 1) {
      return new Response(null, {
        status: 308,
        headers: { Range: `bytes=0-${partialSize - 1}` },
      });
    }
    if (uploadCount === 2) {
      return new Response(null, {
        status: 308,
        headers: { Range: `bytes=0-${chunkSize - 1}` },
      });
    }
    return new Response(JSON.stringify({ id: "drive_partial", name: "video.mp4" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await uploadDriveFile({
      accessToken: "token",
      response: responseStream(size),
      sizeBytes: size,
      metadata: { name: "video.mp4" },
      mimeType: "video/mp4",
    });

    assert.equal(result.id, "drive_partial");
    assert.deepEqual(ranges, [
      `bytes 0-${chunkSize - 1}/${size}`,
      `bytes ${partialSize}-${chunkSize - 1}/${size}`,
      `bytes ${chunkSize}-${size - 1}/${size}`,
    ]);
    assert.deepEqual(bodySizes, [chunkSize, chunkSize - partialSize, 1]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OneDrive uses an upload session above 4 MB without reading the full body", async () => {
  const originalFetch = globalThis.fetch;
  const size = 4 * 1024 * 1024 + 1;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.includes("createUploadSession")) {
      return new Response(JSON.stringify({
        uploadUrl: "https://tenant.sharepoint.com/upload/session_1",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/session_1")) {
      return new Response(JSON.stringify({ id: "onedrive_1", name: "video.mp4" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const result = await uploadOneDriveFile({
      accessToken: "token",
      response: responseStream(size),
      sizeBytes: size,
      folderPath: "/Media",
      filename: "video.mp4",
    });

    assert.equal(result.id, "onedrive_1");
    assert.equal(requests.some(({ url }) => url.endsWith(":/content")), false);
    const upload = requests.find(({ url }) => url.endsWith("/session_1"));
    assert.ok(upload);
    assert.equal(
      (upload.init?.headers as Record<string, string>)["Content-Range"],
      `bytes 0-${size - 1}/${size}`,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OneDrive validates intermediate ranges and rejects an incomplete final response", async () => {
  const originalFetch = globalThis.fetch;
  const chunkSize = 10 * 1024 * 1024;
  const size = chunkSize + 1;
  let uploadCount = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("createUploadSession")) {
      return new Response(JSON.stringify({
        uploadUrl: "https://tenant.sharepoint.com/upload/session_incomplete",
      }), { status: 200 });
    }
    if (url.endsWith("/session_incomplete")) {
      uploadCount += 1;
      return new Response(JSON.stringify({
        nextExpectedRanges: [`${uploadCount === 1 ? chunkSize : size}-`],
      }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    await assert.rejects(uploadOneDriveFile({
      accessToken: "token",
      response: responseStream(size),
      sizeBytes: size,
      folderPath: "/Media",
      filename: "video.mp4",
    }), /chunk upload failed \(HTTP 202\)/);
    assert.equal(uploadCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
