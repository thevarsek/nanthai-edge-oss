import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const webLocales = ["de", "en", "es", "fr", "it", "ja", "zh"] as const;
const androidValueDirs = ["values", "values-de", "values-es", "values-fr", "values-it", "values-ja", "values-zh-rCN"] as const;
const iosLocales = ["de", "es", "fr", "it", "ja", "zh-Hans"] as const;

const localizedKeys = [
  "saved_document",
  "word_document",
  "spreadsheet",
  "presentation",
  "pdf",
  "csv",
  "image",
  "add",
  "add_newly_created_document_next_message",
  "folder",
] as const;

const iosKeyMap: Record<(typeof localizedKeys)[number], string> = {
  saved_document: "Saved document",
  word_document: "Word document",
  spreadsheet: "Spreadsheet",
  presentation: "Presentation",
  pdf: "PDF",
  csv: "CSV",
  image: "Image",
  add: "Add",
  add_newly_created_document_next_message: "Add newly created document to the next message",
  folder: "Folder",
};

test("M33 web localization keys exist in every shipped locale", async () => {
  for (const locale of webLocales) {
    const file = path.join(repoRoot, "web/src/i18n/locales", `${locale}.json`);
    const strings = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;

    for (const key of localizedKeys) {
      const value = strings[key];
      assert.equal(typeof value, "string", `${locale}.json missing ${key}`);
      assert.notEqual((value as string).trim(), "", `${locale}.json has empty ${key}`);
    }
  }
});

test("M33 Android localization keys exist in every shipped values directory", async () => {
  for (const dir of androidValueDirs) {
    const file = path.join(repoRoot, "android/app/src/main/res", dir, "strings.xml");
    const xml = await readFile(file, "utf8");

    for (const key of localizedKeys) {
      assert.match(xml, new RegExp(`<string name="${key}">[^<]+</string>`), `${dir}/strings.xml missing ${key}`);
    }
  }
});

test("M33 iOS string catalog has localizations for document card, attach suggestion, and Folder", async () => {
  const file = path.join(repoRoot, "NanthAi-Edge/NanthAi-Edge/Localizable.xcstrings");
  const catalog = JSON.parse(await readFile(file, "utf8")) as {
    strings: Record<string, { localizations?: Record<string, { stringUnit?: { value?: string } }> }>;
  };

  for (const [resourceKey, iosKey] of Object.entries(iosKeyMap)) {
    const entry = catalog.strings[iosKey];
    assert.ok(entry, `Localizable.xcstrings missing ${resourceKey} (${iosKey})`);

    for (const locale of iosLocales) {
      const value = entry.localizations?.[locale]?.stringUnit?.value;
      assert.equal(typeof value, "string", `Localizable.xcstrings missing ${locale} for ${iosKey}`);
      assert.notEqual(value?.trim(), "", `Localizable.xcstrings has empty ${locale} for ${iosKey}`);
    }
  }
});
