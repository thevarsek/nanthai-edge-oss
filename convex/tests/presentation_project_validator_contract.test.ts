import assert from "node:assert/strict";
import test from "node:test";
import { presentationSchemaTables } from "../schema_tables_presentations";
import { presentationProjectDocValidator } from "../presentations/validators";

function objectFieldNames(json: unknown): string[] {
  if (typeof json !== "object" || json === null) {
    assert.fail("Expected an object validator");
  }
  const objectValidator = json as { type?: unknown; value?: unknown };
  assert.equal(objectValidator.type, "object");
  if (typeof objectValidator.value !== "object" || objectValidator.value === null) {
    assert.fail("Expected object validator fields");
  }
  return Object.keys(objectValidator.value);
}

test("presentation project return validator includes every persisted field", () => {
  const schemaValidator = presentationSchemaTables.presentationProjects.validator as unknown as {
    json: unknown;
  };
  const returnValidator = presentationProjectDocValidator as unknown as { json: unknown };
  const schemaFields = objectFieldNames(
    schemaValidator.json,
  );
  const returnedFields = objectFieldNames(returnValidator.json);

  assert.deepEqual(
    returnedFields.toSorted(),
    [...schemaFields, "_creationTime", "_id"].toSorted(),
  );
});
