export async function* readFixedSizeChunks(
  response: Response,
  chunkSize: number,
): AsyncGenerator<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 0) yield bytes;
    return;
  }

  const reader = response.body.getReader();
  let buffer = new Uint8Array(chunkSize);
  let buffered = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      let sourceOffset = 0;
      while (sourceOffset < value.length) {
        const copied = Math.min(chunkSize - buffered, value.length - sourceOffset);
        buffer.set(value.subarray(sourceOffset, sourceOffset + copied), buffered);
        buffered += copied;
        sourceOffset += copied;
        if (buffered === chunkSize) {
          yield buffer;
          buffer = new Uint8Array(chunkSize);
          buffered = 0;
        }
      }
    }
    if (buffered > 0) yield buffer.slice(0, buffered);
  } finally {
    reader.releaseLock();
  }
}
