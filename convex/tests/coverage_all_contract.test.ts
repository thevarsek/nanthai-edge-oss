import assert from "node:assert/strict";
import test from "node:test";

import * as chatActionsNode from "../chat/actions_node";
import * as chatActionsRuntime from "../chat/actions_runtime";
import * as searchActions from "../search/actions";
import * as searchMutations from "../search/mutations";

test("stable action and mutation registration modules stay wired", () => {
  assert.equal(typeof (chatActionsNode.runGenerationParticipantNode as any)._handler, "function");
  assert.equal(typeof (chatActionsRuntime.runGeneration as any)._handler, "function");
  assert.equal(typeof (chatActionsRuntime.runGenerationParticipant as any)._handler, "function");

  assert.equal(typeof (searchActions.runWebSearch as any)._handler, "function");
  assert.equal(typeof (searchActions.regeneratePaperAction as any)._handler, "function");

  assert.equal(typeof (searchMutations.updateSearchSession as any)._handler, "function");
  assert.equal(typeof (searchMutations.patchMessageSearchContext as any)._handler, "function");
  assert.equal(typeof (searchMutations.writeSearchPhase as any)._handler, "function");
  assert.equal(typeof (searchMutations.cleanStaleSearchPhases as any)._handler, "function");
  assert.equal(typeof (searchMutations.startResearchPaper as any)._handler, "function");
  assert.equal(typeof (searchMutations.cancelResearchPaper as any)._handler, "function");
  assert.equal(typeof (searchMutations.regeneratePaper as any)._handler, "function");
  assert.equal(typeof (searchMutations.repairInvalidMessagePersonas as any)._handler, "function");
});
