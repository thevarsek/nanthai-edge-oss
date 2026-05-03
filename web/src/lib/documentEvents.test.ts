import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { hasDocumentAttachmentPayload } from "./documentEvents";

function loadM34Fixture() {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), "../fixtures/m34/document_artifacts.json"), "utf8"),
  ) as {
    documentEvent: Record<string, unknown>;
    futureEvents: Record<string, Record<string, unknown>>;
  };
}

describe("document event guards", () => {
  test("accepts shared generated-document fixture events as attachable", () => {
    const fixture = loadM34Fixture();

    expect(hasDocumentAttachmentPayload(fixture.documentEvent)).toBe(true);
  });

  test("ignores future workflow events that are not generated-file attachments", () => {
    const fixture = loadM34Fixture();

    expect(hasDocumentAttachmentPayload(fixture.futureEvents.documentEditAnnotations)).toBe(false);
    expect(hasDocumentAttachmentPayload(fixture.futureEvents.tabularReviewCreated)).toBe(false);
  });
});
