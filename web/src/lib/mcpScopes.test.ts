import { expect, it } from "vitest";
import { selectedMcpScopes } from "./mcpScopes";

const offered = ["history:read", "chat:write", "chat:tools", "runtime:local"];

it("selects ordinary scopes by default and opt-in scopes only when toggled", () => {
  expect(selectedMcpScopes(offered, [])).toEqual(["history:read", "chat:write"]);
  expect(selectedMcpScopes(offered, ["chat:write", "chat:tools"])).toEqual(["history:read", "chat:tools"]);
  expect(selectedMcpScopes(offered, ["chat:tools", "runtime:local"])).toEqual(offered);
});

it("drops paired-computer access when tool access is not chosen", () => {
  expect(selectedMcpScopes(offered, ["runtime:local"])).toEqual(["history:read", "chat:write"]);
  expect(selectedMcpScopes(["history:read", "runtime:local"], ["runtime:local"])).toEqual(["history:read"]);
});
