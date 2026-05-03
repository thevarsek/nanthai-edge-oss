import { describe, expect, test } from "vitest";

import {
  participantIndexForId,
  participantKey,
  resolveSelectedParticipantId,
} from "./autonomousParticipants";

describe("autonomous participants", () => {
test("participantKey prefers stable Convex participant ids over array indexes", () => {
  expect(participantKey({ id: "chatParticipant_1" }, 0)).toBe("chatParticipant_1");
  expect(participantKey({}, 1)).toBe("1");
});

test("resolveSelectedParticipantId migrates legacy index selections to stable ids", () => {
  const participants = [{ id: "p0" }, { id: "p1" }, { id: "p2" }];

  expect(resolveSelectedParticipantId("1", participants)).toBe("p1");
  expect(resolveSelectedParticipantId("p2", participants)).toBe("p2");
});

test("resolveSelectedParticipantId keeps legacy indexes when stable ids are absent", () => {
  const participants = [{}, {}, {}];

  expect(resolveSelectedParticipantId("1", participants)).toBe("1");
});

test("resolveSelectedParticipantId clears invalid stale selections", () => {
  const participants = [{ id: "p0" }, { id: "p1" }, { id: "p2" }];

  expect(resolveSelectedParticipantId("p3", participants)).toBeNull();
  expect(resolveSelectedParticipantId("7", participants)).toBeNull();
  expect(resolveSelectedParticipantId("1abc", participants)).toBeNull();
});

test("participantIndexForId resolves stable ids and legacy numeric ids", () => {
  const participants = [{ id: "p0" }, { id: "p1" }, {}];

  expect(participantIndexForId("p1", participants)).toBe(1);
  expect(participantIndexForId("2", participants)).toBe(2);
  expect(participantIndexForId("missing", participants)).toBeUndefined();
});
});
