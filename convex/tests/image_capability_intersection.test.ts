import assert from "node:assert/strict";
import test from "node:test";

import {
  intersectImageSupportedParameters,
  intersectStringLists,
} from "../models/image_capability_intersection";

test("image capability intersection retains only endpoint-safe enum values", () => {
  const result = intersectImageSupportedParameters({
    resolution: {
      type: "enum",
      values: ["", "1K", "2K", "1K", "4K"],
    },
    quality: { type: "enum", values: ["low", "high"] },
  }, [
    {
      resolution: { type: "enum", values: ["1K", "2K", ""] },
      quality: { type: "enum", values: ["low", "high"] },
      seed: { type: "boolean" },
    },
    {
      resolution: { type: "enum", values: ["1K", "2K", "4K"] },
      seed: { type: "boolean" },
    },
  ]);

  assert.deepEqual(result, {
    resolution: { type: "enum", values: ["1K", "2K"] },
  });
});

test("image capability intersection narrows numeric ranges", () => {
  const result = intersectImageSupportedParameters({
    n: { type: "range", min: 1, max: 10 },
    input_references: { type: "range", min: 0, max: 16 },
    stream: { type: "boolean" },
  }, [
    {
      n: { type: "range", min: 1, max: 4 },
      input_references: { type: "range", min: 0, max: 14 },
      stream: { type: "boolean" },
    },
    {
      n: { type: "range", min: 2, max: 10 },
      input_references: { type: "range", min: 2, max: 16 },
      stream: { type: "boolean" },
    },
  ]);

  assert.deepEqual(result, {
    n: { type: "range", min: 2, max: 4 },
    input_references: { type: "range", min: 2, max: 14 },
    stream: { type: "boolean" },
  });
});

test("image capability intersection drops incompatible descriptors", () => {
  const result = intersectImageSupportedParameters({
    resolution: { type: "enum", values: ["1K", "2K"] },
    n: { type: "range", min: 1, max: 10 },
    quality: { type: "enum", values: ["low", "high"] },
    background: { type: "boolean" },
    mystery: { type: "future", values: ["x"] },
    incomplete: { type: "range", min: 1 },
    contradictory_enum: {
      type: "enum",
      values: ["x"],
      min: 1,
    },
    contradictory_untyped: { values: ["x"], max: 1 },
  }, [
    {
      resolution: { type: "enum", values: ["1K"] },
      n: { type: "range", min: 1, max: 2 },
      quality: { type: "enum", values: ["low"] },
      background: { type: "range", min: 0, max: 1 },
      mystery: { type: "future", values: ["x"] },
      incomplete: { type: "range", min: 1 },
      contradictory_enum: {
        type: "enum",
        values: ["x"],
        min: 1,
      },
      contradictory_untyped: { values: ["x"], max: 1 },
    },
    {
      resolution: { type: "enum", values: ["2K"] },
      n: { type: "range", min: 3, max: 4 },
      quality: { type: "enum", values: ["LOW"] },
      background: { type: "boolean" },
      mystery: { type: "future", values: ["x"] },
      incomplete: { type: "range", min: 1 },
      contradictory_enum: {
        type: "enum",
        values: ["x"],
        min: 1,
      },
      contradictory_untyped: { values: ["x"], max: 1 },
    },
  ]);

  assert.deepEqual(result, {});
});

test("image capability intersection fails closed without definitive endpoints", () => {
  const modelParameters = {
    resolution: { type: "enum", values: ["1K", "2K", "4K"] },
  };

  assert.deepEqual(intersectImageSupportedParameters(modelParameters, []), {});
  assert.deepEqual(
    intersectImageSupportedParameters(modelParameters, [{}]),
    {},
  );
});

test("passthrough intersection preserves first-endpoint order", () => {
  assert.deepEqual(intersectStringLists([
    ["moderation", "safety", "moderation"],
    ["safety", "moderation", "seed"],
    ["moderation", "safety"],
  ]), ["moderation", "safety"]);
  assert.deepEqual(intersectStringLists([]), []);
});
