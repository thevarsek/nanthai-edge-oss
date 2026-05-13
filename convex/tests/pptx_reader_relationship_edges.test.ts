import assert from "node:assert/strict";
import test from "node:test";

import JSZip from "jszip";

import { extractPptxContent } from "../tools/pptx_reader";
import { readPptx } from "../tools/read_pptx";

function slideXml(text?: string) {
  const body = text
    ? `<p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld><p:spTree>${body}</p:spTree></p:cSld>
    </p:sld>`;
}

async function buildDeck(files: (zip: JSZip) => void): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("ppt/presentation.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:sldIdLst>
        <p:sldId id="256" r:id="rId1"/>
        <p:sldId id="257" r:id="rId2"/>
        <p:sldId id="258" r:id="rId3"/>
      </p:sldIdLst>
    </p:presentation>`);
  files(zip);
  return zip.generateAsync({ type: "arraybuffer" });
}

test("extractPptxContent handles absolute notes targets, missing notes, and stale slide relationships", async () => {
  const deck = await buildDeck((zip) => {
    zip.file("ppt/_rels/presentation.xml.rels", `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Target="slides/slide1.xml"/>
        <Relationship Id="rId2" Target="slides/slide2.xml"/>
        <Relationship Id="rId3" Target="slides/missing.xml"/>
      </Relationships>`);
    zip.file("ppt/slides/slide1.xml", slideXml("Launch plan"));
    zip.file("ppt/slides/slide2.xml", slideXml("Budget review"));
    zip.file("ppt/slides/_rels/slide1.xml.rels", `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="notes1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="ppt/notesSlides/notesSlide1.xml"/>
      </Relationships>`);
    zip.file("ppt/slides/_rels/slide2.xml.rels", `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="notes2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/missing.xml"/>
      </Relationships>`);
    zip.file("ppt/notesSlides/notesSlide1.xml", `<?xml version="1.0" encoding="UTF-8"?>
      <p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:cSld><p:spTree>
          <p:sp><p:txBody><a:p><a:r><a:t>Discuss risks</a:t></a:r></a:p></p:txBody></p:sp>
        </p:spTree></p:cSld>
      </p:notes>`);
  });

  const result = await extractPptxContent(deck);

  assert.equal(result.slideCount, 3);
  assert.deepEqual(result.slides.map((slide) => slide.title), ["Launch plan", "Budget review"]);
  assert.equal(result.slides[0].notesText, "Discuss risks");
  assert.equal(result.slides[1].notesText, "");
});

test("readPptx reports empty presentations and non-Error storage payload failures", async () => {
  const emptyDeck = await buildDeck((zip) => {
    zip.file("ppt/_rels/presentation.xml.rels", `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Target="slides/slide1.xml"/>
      </Relationships>`);
    zip.file("ppt/slides/slide1.xml", slideXml());
  });

  const empty = await readPptx.execute({
    ctx: {
      storage: {
        get: async () => new Blob([emptyDeck]),
      },
    },
  } as any, { storageId: "deck_empty" });
  assert.equal(empty.success, true);
  assert.equal((empty.data as any).text, "");
  assert.match((empty.data as any).message, /no extractable text/i);

  const badBytes = await readPptx.execute({
    ctx: {
      storage: {
        get: async () => ({
          arrayBuffer: async () => {
            throw "bad bytes";
          },
        }),
      },
    },
  } as any, { storageId: "deck_bad_bytes" });
  assert.equal(badBytes.success, false);
  assert.match(String(badBytes.error), /bad bytes/);
});
