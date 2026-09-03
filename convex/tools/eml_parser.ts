export interface ParsedEmail {
  headers: Record<string, string>;
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  date?: string;
  bodyText?: string;
  bodyHtml?: string;
  rawBody: string;
}

export function parseEml(raw: string): ParsedEmail {
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const headerBodySplit = text.indexOf("\n\n");
  const headerSection = headerBodySplit >= 0 ? text.substring(0, headerBodySplit) : text;
  const rawBody = headerBodySplit >= 0 ? text.substring(headerBodySplit + 2) : "";
  const headers = parseHeaders(headerSection);
  const result: ParsedEmail = {
    headers,
    from: headers.from,
    to: headers.to,
    cc: headers.cc,
    subject: headers.subject,
    date: headers.date,
    rawBody,
  };

  const contentType = headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary="?([^";\n]+)"?/i);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1].trim();
    for (const part of splitMultipart(rawBody, boundary)) collectBodyParts(part, result);
  } else if (contentType.includes("text/html")) {
    result.bodyHtml = decodePartBody(rawBody, headerSection);
  } else {
    result.bodyText = decodePartBody(rawBody, headerSection);
  }
  return result;
}

function parseHeaders(binaryHeaderSection: string): Record<string, string> {
  const decoded = decodeBytes(binaryStringToBytes(binaryHeaderSection), "utf-8");
  const unfolded = decoded.replace(/\n[ \t]+/g, " ");
  const headers: Record<string, string> = {};
  for (const line of unfolded.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex <= 0) continue;
    const key = line.substring(0, colonIndex).trim().toLowerCase();
    const value = decodeMimeWords(line.substring(colonIndex + 1).trim());
    headers[key] = headers[key] ? `${headers[key]}, ${value}` : value;
  }
  return headers;
}

function collectBodyParts(part: string, result: ParsedEmail): void {
  const contentType = extractPartHeader(part, "content-type") ?? "";
  const disposition = extractPartHeader(part, "content-disposition") ?? "";
  if (/attachment/i.test(disposition)) return;
  const body = extractPartBody(part);
  const nestedBoundary = contentType.match(/boundary="?([^";\n]+)"?/i)?.[1]?.trim();
  if (nestedBoundary) {
    for (const nestedPart of splitMultipart(body, nestedBoundary)) {
      collectBodyParts(nestedPart, result);
    }
  } else if (/text\/plain/i.test(contentType)) {
    result.bodyText = decodePartBody(body, part);
  } else if (/text\/html/i.test(contentType)) {
    result.bodyHtml = decodePartBody(body, part);
  }
}

function splitMultipart(body: string, boundary: string): string[] {
  const parts: string[] = [];
  const delimiter = `--${boundary}`;
  const endDelimiter = `--${boundary}--`;
  const segments = body.split(delimiter);
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index].trim();
    if (segment.startsWith("--") || segment === "") continue;
    if (segment === endDelimiter.substring(delimiter.length)) continue;
    parts.push(segment);
  }
  return parts;
}

function extractPartHeader(part: string, headerName: string): string | undefined {
  const blankLine = part.indexOf("\n\n");
  const headerSection = blankLine >= 0 ? part.substring(0, blankLine) : part;
  return parseHeaders(headerSection)[headerName.toLowerCase()];
}

function extractPartBody(part: string): string {
  const blankLine = part.indexOf("\n\n");
  return blankLine >= 0 ? part.substring(blankLine + 2) : "";
}

function decodePartBody(body: string, headerSource: string): string {
  const contentType = extractPartHeader(headerSource, "content-type") ?? "";
  const transferEncoding = extractPartHeader(headerSource, "content-transfer-encoding")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  const charset = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType)?.[1];
  if (transferEncoding === "quoted-printable") {
    return decodeBytes(decodeQuotedPrintableBytes(body), charset);
  }
  if (transferEncoding === "base64") {
    try {
      const raw = atob(body.replace(/\s/g, ""));
      return decodeBytes(Uint8Array.from(raw, (character) => character.charCodeAt(0)), charset);
    } catch {
      return body;
    }
  }
  return decodeBytes(binaryStringToBytes(body), charset);
}

function decodeBytes(bytes: Uint8Array, charset?: string): string {
  try {
    return new TextDecoder(charset || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

function binaryStringToBytes(value: string): Uint8Array {
  return Uint8Array.from(value, (character) => character.charCodeAt(0) & 0xff);
}

export function bytesToBinaryString(bytes: Uint8Array): string {
  let result = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return result;
}

function decodeQuotedPrintableBytes(text: string): Uint8Array {
  const normalized = text.replace(/=\n/g, "");
  const bytes: number[] = [];
  let literal = "";
  const flushLiteral = () => {
    if (!literal) return;
    bytes.push(...binaryStringToBytes(literal));
    literal = "";
  };
  for (let index = 0; index < normalized.length; index += 1) {
    const match = normalized.slice(index).match(/^=([0-9A-Fa-f]{2})/);
    if (!match) {
      literal += normalized[index];
      continue;
    }
    flushLiteral();
    bytes.push(Number.parseInt(match[1], 16));
    index += 2;
  }
  flushLiteral();
  return new Uint8Array(bytes);
}

function decodeMimeWords(value: string): string {
  const joined = value.replace(/\?=\s+=\?/g, "?==?");
  return joined.replace(
    /=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,
    (word, charset: string, encoding: string, encoded: string) => {
      try {
        if (encoding.toLowerCase() === "b") {
          const raw = atob(encoded.replace(/\s/g, ""));
          return decodeBytes(
            Uint8Array.from(raw, (character) => character.charCodeAt(0)),
            charset,
          );
        }
        return decodeBytes(
          decodeQuotedPrintableBytes(encoded.replace(/_/g, " ")),
          charset,
        );
      } catch {
        return word;
      }
    },
  );
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
