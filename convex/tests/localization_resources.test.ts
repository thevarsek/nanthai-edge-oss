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

const iosKeyMap: Record<
  (typeof localizedKeys)[number],
  { catalog: string; key: string }
> = {
  saved_document: { catalog: "Attachments", key: "Saved document" },
  word_document: { catalog: "Attachments", key: "Word document" },
  spreadsheet: { catalog: "Localizable", key: "Spreadsheet" },
  presentation: { catalog: "Localizable", key: "Presentation" },
  pdf: { catalog: "Attachments", key: "PDF" },
  csv: { catalog: "Localizable", key: "CSV" },
  image: { catalog: "Attachments", key: "Image" },
  add: { catalog: "Common", key: "Add" },
  add_newly_created_document_next_message: {
    catalog: "Chat",
    key: "Add newly created document to the next message",
  },
  folder: { catalog: "Attachments", key: "Folder" },
};

const imageDefaultWebKeys = [
  "image_defaults_count",
  "image_defaults_aspect_ratio",
  "image_defaults_resolution_size",
  "image_defaults_quality",
  "image_defaults_background",
  "image_defaults_output_format",
  "image_defaults_compression",
  "image_defaults_model_default",
  "image_defaults_auto",
  "image_defaults_transparent",
  "image_defaults_opaque",
  "image_defaults_adaptation_hint",
] as const;

const imageDefaultAndroidKeys = [
  ...imageDefaultWebKeys,
  "image_defaults_compression_range",
] as const;

const imageAdaptationIOSKey = "If the selected model doesn't support a chosen image setting, NanthAI Edge uses a supported value or omits the setting when needed. Generating more images increases cost.";
const videoAdaptationIOSKey = "If the selected model doesn't support the chosen duration or resolution, NanthAI Edge uses the closest lower supported option when possible.";

const imageDefaultIOSKeys = {
  Settings: [
    "Aspect / Orientation",
    "Background",
    "Compression",
    "Image Count",
    "Landscape (16:9)",
    "Landscape (3:2)",
    "Landscape (4:3)",
    "Landscape (5:4)",
    "Model Default",
    imageAdaptationIOSKey,
    "Opaque",
    "Output Compression",
    "Output Format",
    "Portrait (2:3)",
    "Portrait (3:4)",
    "Portrait (4:5)",
    "Portrait (9:16)",
    "Quality",
    "Resolution / Size",
    "Square (1:1)",
    "Transparent",
    "Ultrawide (21:9)",
  ],
  Common: ["Auto", "Custom", "High", "Low", "Medium"],
  Localizable: ["$%.2f / image", "$%.3f / image", "$%.4f / image", "Per image"],
  Models: ["Image Generation"],
} as const;

const mediaCapabilityWebKeys = [
  "media_generation_options",
  "media_images_per_request",
  "media_image_references",
  "media_up_to_count",
  "media_up_to_images",
  "media_image_editing",
  "media_aspect_ratios",
  "media_resolutions_sizes",
  "media_streaming",
  "media_supported",
  "media_not_supported",
  "media_frame_inputs",
  "media_audio_generation",
  "media_seed_control",
  "media_audio",
  "media_first_frame",
  "media_last_frame",
  "media_reference_image",
  "media_reference_images",
] as const;

const mediaCapabilityAndroidStringKeys = [
  "model_media_generation_options",
  "model_media_images",
  "model_media_aspect_ratios",
  "model_media_resolutions",
  "model_media_sizes",
  "model_media_input_images",
  "model_media_streaming",
  "model_media_durations",
  "model_media_reference_frames",
  "model_media_seed",
  "model_media_up_to_value",
  "model_media_at_least_value",
  "model_media_count_range",
  "model_media_image_editing",
  "model_media_image_to_video",
] as const;

const mediaCapabilityAndroidPluralKeys = [
  "model_media_up_to_images",
  "model_media_up_to_seconds",
] as const;

const mediaCapabilityIOSKeys = [
  "Audio generation",
  "Durations",
  "Frame guidance",
  "Generation Options",
  "Image editing",
  videoAdaptationIOSKey,
  "Reference images",
  "Resolutions",
  "Seed control",
  "Sizes",
  "Streaming",
  "The model can generate video output.",
  "Up to %lld images",
] as const;

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

test("M33 iOS string catalogs localize document cards and attach suggestions", async () => {
  type Catalog = {
    strings: Record<string, { localizations?: Record<string, { stringUnit?: { value?: string } }> }>;
  };
  const catalogs = new Map<string, Catalog>();

  for (const [resourceKey, location] of Object.entries(iosKeyMap)) {
    let catalog = catalogs.get(location.catalog);
    if (!catalog) {
      const file = path.join(
        repoRoot,
        "NanthAi-Edge/NanthAi-Edge",
        `${location.catalog}.xcstrings`,
      );
      catalog = JSON.parse(await readFile(file, "utf8")) as Catalog;
      catalogs.set(location.catalog, catalog);
    }
    const entry = catalog.strings[location.key];
    assert.ok(
      entry,
      `${location.catalog}.xcstrings missing ${resourceKey} (${location.key})`,
    );

    for (const locale of iosLocales) {
      const value = entry.localizations?.[locale]?.stringUnit?.value;
      assert.equal(
        typeof value,
        "string",
        `${location.catalog}.xcstrings missing ${locale} for ${location.key}`,
      );
      assert.notEqual(
        value?.trim(),
        "",
        `${location.catalog}.xcstrings has empty ${locale} for ${location.key}`,
      );
    }
  }
});

test("image-default web and Android keys exist in every shipped locale", async () => {
  for (const locale of webLocales) {
    const file = path.join(repoRoot, "web/src/i18n/locales", `${locale}.json`);
    const strings = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    for (const key of imageDefaultWebKeys) {
      const value = strings[key];
      assert.equal(typeof value, "string", `${locale}.json missing ${key}`);
      assert.notEqual((value as string).trim(), "", `${locale}.json has empty ${key}`);
    }
  }

  for (const dir of androidValueDirs) {
    const file = path.join(repoRoot, "android/app/src/main/res", dir, "strings.xml");
    const xml = await readFile(file, "utf8");
    for (const key of imageDefaultAndroidKeys) {
      assert.match(
        xml,
        new RegExp(`<string name="${key}">[^<]+</string>`),
        `${dir}/strings.xml missing ${key}`,
      );
    }
  }
});

test("image-default iOS keys exist in their runtime string catalogs", async () => {
  type Catalog = {
    strings: Record<string, { localizations?: Record<string, { stringUnit?: { value?: string } }> }>;
  };

  for (const [catalogName, keys] of Object.entries(imageDefaultIOSKeys)) {
    const file = path.join(
      repoRoot,
      "NanthAi-Edge/NanthAi-Edge",
      `${catalogName}.xcstrings`,
    );
    const catalog = JSON.parse(await readFile(file, "utf8")) as Catalog;
    for (const key of keys) {
      const entry = catalog.strings[key];
      assert.ok(entry, `${catalogName}.xcstrings missing ${key}`);
      for (const locale of iosLocales) {
        const value = entry.localizations?.[locale]?.stringUnit?.value;
        assert.equal(
          typeof value,
          "string",
          `${catalogName}.xcstrings missing ${locale} for ${key}`,
        );
        assert.notEqual(
          value?.trim(),
          "",
          `${catalogName}.xcstrings has empty ${locale} for ${key}`,
        );
      }
    }
  }
});

test("model media-capability UI is localized on every client", async () => {
  for (const locale of webLocales) {
    const file = path.join(repoRoot, "web/src/i18n/locales", `${locale}.json`);
    const strings = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    for (const key of mediaCapabilityWebKeys) {
      const value = strings[key];
      assert.equal(typeof value, "string", `${locale}.json missing ${key}`);
      assert.notEqual((value as string).trim(), "", `${locale}.json has empty ${key}`);
    }
  }

  for (const dir of androidValueDirs) {
    const file = path.join(repoRoot, "android/app/src/main/res", dir, "strings.xml");
    const xml = await readFile(file, "utf8");
    for (const key of mediaCapabilityAndroidStringKeys) {
      assert.match(
        xml,
        new RegExp(`<string name="${key}">[^<]+</string>`),
        `${dir}/strings.xml missing ${key}`,
      );
    }
    for (const key of mediaCapabilityAndroidPluralKeys) {
      assert.match(
        xml,
        new RegExp(`<plurals name="${key}">[\\s\\S]*?</plurals>`),
        `${dir}/strings.xml missing ${key}`,
      );
    }
  }

  type Catalog = {
    strings: Record<string, { localizations?: Record<string, { stringUnit?: { value?: string } }> }>;
  };
  const file = path.join(repoRoot, "NanthAi-Edge/NanthAi-Edge/Models.xcstrings");
  const catalog = JSON.parse(await readFile(file, "utf8")) as Catalog;
  for (const key of mediaCapabilityIOSKeys) {
    const entry = catalog.strings[key];
    assert.ok(entry, `Models.xcstrings missing ${key}`);
    for (const locale of iosLocales) {
      const value = entry.localizations?.[locale]?.stringUnit?.value;
      assert.equal(typeof value, "string", `Models.xcstrings missing ${locale} for ${key}`);
      assert.notEqual(value?.trim(), "", `Models.xcstrings has empty ${locale} for ${key}`);
    }
  }
});

test("media-default adaptation copy consistently uses the product name", async () => {
  for (const locale of webLocales) {
    const file = path.join(repoRoot, "web/src/i18n/locales", `${locale}.json`);
    const strings = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    const value = strings.image_defaults_adaptation_hint;
    assert.equal(typeof value, "string", `${locale}.json missing image adaptation copy`);
    assert.match(value as string, /NanthAI Edge/);
    assert.doesNotMatch(value as string, /Convex/i);
    const videoValue = strings.video_config_snap_hint;
    assert.equal(typeof videoValue, "string", `${locale}.json missing video adaptation copy`);
    assert.match(videoValue as string, /NanthAI Edge/);
    assert.doesNotMatch(videoValue as string, /Convex/i);
  }

  for (const dir of androidValueDirs) {
    const file = path.join(repoRoot, "android/app/src/main/res", dir, "strings.xml");
    const xml = await readFile(file, "utf8");
    const match = xml.match(
      /<string name="image_defaults_adaptation_hint">([^<]+)<\/string>/,
    );
    assert.ok(match?.[1], `${dir}/strings.xml missing image adaptation copy`);
    assert.match(match[1], /NanthAI Edge/);
    assert.doesNotMatch(match[1], /Convex/i);
    const videoMatch = xml.match(
      /<string name="video_defaults_footer">([^<]+)<\/string>/,
    );
    assert.ok(videoMatch?.[1], `${dir}/strings.xml missing video adaptation copy`);
    assert.match(videoMatch[1], /NanthAI Edge/);
    assert.doesNotMatch(videoMatch[1], /Convex/i);
  }

  type Catalog = {
    strings: Record<string, { localizations?: Record<string, { stringUnit?: { value?: string } }> }>;
  };
  const file = path.join(repoRoot, "NanthAi-Edge/NanthAi-Edge/Settings.xcstrings");
  const catalog = JSON.parse(await readFile(file, "utf8")) as Catalog;
  const key = imageAdaptationIOSKey;
  const entry = catalog.strings[key];
  assert.ok(entry, `Settings.xcstrings missing ${key}`);
  for (const locale of iosLocales) {
    const value = entry.localizations?.[locale]?.stringUnit?.value;
    assert.equal(typeof value, "string", `Settings.xcstrings missing ${locale} for ${key}`);
    assert.match(value as string, /NanthAI Edge/);
    assert.doesNotMatch(value as string, /Convex/i);
  }

  const modelsFile = path.join(repoRoot, "NanthAi-Edge/NanthAi-Edge/Models.xcstrings");
  const modelsCatalog = JSON.parse(await readFile(modelsFile, "utf8")) as Catalog;
  const videoEntry = modelsCatalog.strings[videoAdaptationIOSKey];
  assert.ok(videoEntry, `Models.xcstrings missing ${videoAdaptationIOSKey}`);
  for (const locale of iosLocales) {
    const value = videoEntry.localizations?.[locale]?.stringUnit?.value;
    assert.equal(typeof value, "string", `Models.xcstrings missing ${locale} video adaptation copy`);
    assert.match(value as string, /NanthAI Edge/);
    assert.doesNotMatch(value as string, /Convex/i);
  }
});
