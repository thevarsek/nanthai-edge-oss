import assert from "node:assert/strict";
import test from "node:test";

import {
  participantIndexForId,
  participantKey,
  resolveSelectedParticipantId,
} from "./autonomousParticipants";

test("participantKey prefers stable Convex participant ids over array indexes", () => {
  assert.equal(participantKey({ id: "chatParticipant_1" }, 0), "chatParticipant_1");
  assert.equal(participantKey({}, 1), "1");
});

test("resolveSelectedParticipantId migrates legacy index selections to stable ids", () => {
  const participants = [{ id: "p0" }, { id: "p1" }, { id: "p2" }];

  assert.equal(resolveSelectedParticipantId("1", participants), "p1");
  assert.equal(resolveSelectedParticipantId("p2", participants), "p2");
});

test("resolveSelectedParticipantId keeps legacy indexes when stable ids are absent", () => {
  const participants = [{}, {}, {}];

  assert.equal(resolveSelectedParticipantId("1", participants), "1");
});

test("resolveSelectedParticipantId clears invalid stale selections", () => {
  const participants = [{ id: "p0" }, { id: "p1" }, { id: "p2" }];

  assert.equal(resolveSelectedParticipantId("p3", participants), null);
  assert.equal(resolveSelectedParticipantId("7", participants), null);
  assert.equal(resolveSelectedParticipantId("1abc", participants), null);
});

test("participantIndexForId resolves stable ids and legacy numeric ids", () => {
  const participants = [{ id: "p0" }, { id: "p1" }, {}];

  assert.equal(participantIndexForId("p1", participants), 1);
  assert.equal(participantIndexForId("2", participants), 2);
  assert.equal(participantIndexForId("missing", participants), undefined);
});
