import assert from "node:assert/strict";
import test from "node:test";

import {
  compareFoldersForDisplay,
  resolveNextFolderSortOrder,
} from "../folders/shared";

test("compareFoldersForDisplay sorts by sortOrder before createdAt", () => {
  const folders = [
    { name: "Later", sortOrder: 2, createdAt: 50 },
    { name: "Earlier", sortOrder: 0, createdAt: 100 },
    { name: "Middle", sortOrder: 1, createdAt: 10 },
  ];

  folders.sort(compareFoldersForDisplay);

  assert.deepEqual(folders.map((folder) => folder.name), [
    "Earlier",
    "Middle",
    "Later",
  ]);
});

test("resolveNextFolderSortOrder uses the next highest sort order", () => {
  assert.equal(
    resolveNextFolderSortOrder([
      { sortOrder: 0 },
      { sortOrder: 4 },
      { sortOrder: 2 },
    ]),
    5,
  );

  assert.equal(resolveNextFolderSortOrder([]), 0);
});
