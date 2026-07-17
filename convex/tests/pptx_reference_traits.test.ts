import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { extractPptxContent } from "../tools/pptx_reader";

test("PPTX references expose theme, layout geometry, and reusable embedded images", async () => {
  const zip = new JSZip();
  zip.file("ppt/presentation.xml", `
    <p:presentation xmlns:p="p"><p:sldIdLst><p:sldId r:id="rId1"/></p:sldIdLst>
    <p:sldSz cx="12192000" cy="6858000"/></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", `
    <Relationships><Relationship Target="slides/slide1.xml" Type="slide" Id="rId1"/></Relationships>`);
  zip.file("ppt/theme/theme1.xml", `
    <a:theme xmlns:a="a"><a:themeElements><a:clrScheme>
      <a:dk1><a:srgbClr val="112233"/></a:dk1><a:accent1><a:srgbClr val="FF5500"/></a:accent1>
    </a:clrScheme><a:fontScheme><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont>
    <a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`);
  zip.file("ppt/slides/slide1.xml", `
    <p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:bg><a:srgbClr val="F5F1E8"/></p:bg><p:spTree>
      <p:sp><p:nvSpPr><p:cNvPr id="2" name="Headline"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1219200" y="685800"/><a:ext cx="6096000" cy="1371600"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Reference title</a:t></a:r></a:p></p:txBody></p:sp>
      <p:pic><p:nvPicPr><p:cNvPr id="3" name="Hero image"/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImage"/></p:blipFill><p:spPr><a:xfrm rot="60000"><a:off x="7315200" y="1371600"/><a:ext cx="3657600" cy="4114800"/></a:xfrm></p:spPr></p:pic>
    </p:spTree></p:cSld></p:sld>`);
  zip.file("ppt/slides/_rels/slide1.xml.rels", `
    <Relationships>
      <Relationship Type="image" Target="/ppt/media/image1.png" Id="rIdImage"/>
      <Relationship Id="rIdLayout" Target="/ppt/slideLayouts/slideLayout1.xml" Type="slideLayout"/>
    </Relationships>`);
  zip.file("ppt/slideLayouts/slideLayout1.xml", '<p:sldLayout xmlns:p="p" matchingName="Title and Visual"/>');
  zip.file("ppt/media/image1.png", Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));

  const result = await extractPptxContent(await zip.generateAsync({ type: "arraybuffer" }));

  assert.equal(result.referenceTraits.aspectRatio, "1.778:1");
  assert.deepEqual(result.referenceTraits.theme.colors, ["112233", "FF5500"]);
  assert.equal(result.referenceTraits.theme.majorFont, "Aptos Display");
  assert.equal(result.referenceTraits.slides[0]?.layoutName, "Title and Visual");
  assert.equal(result.referenceTraits.slides[0]?.backgroundColor, "F5F1E8");
  assert.deepEqual(result.referenceTraits.slides[0]?.elements[0], {
    kind: "text",
    name: "Headline",
    text: "Reference title",
    x: 0.1,
    y: 0.1,
    width: 0.5,
    height: 0.2,
  });
  assert.equal(result.embeddedImages[0]?.filename, "image1.png");
  assert.deepEqual(result.embeddedImages[0]?.slideNumbers, [1]);
  assert.equal(result.embeddedImages[0]?.placements[0]?.rotation, 1);
});
