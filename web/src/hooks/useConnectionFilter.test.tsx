import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useConnectionFilter } from "./useConnectionFilter";

const state = vi.hoisted(() => ({ query: vi.fn(), all: [{ _id: "cloud" }, { _id: "local" }] }));
vi.mock("convex/react", () => ({ useQuery: (_api: unknown, args: unknown) => state.query(args) }));
vi.mock("@/hooks/useSharedData", () => ({ useSharedData: () => ({ personas: state.all }) }));

describe("useConnectionFilter", () => {
  it("uses the shared catalogue for All and the same backend filter for either connection", () => {
    state.query.mockImplementation((args: { runtimePlacement?: string } | "skip") => args === "skip" ? undefined : [{ _id: args.runtimePlacement }]);
    const { result } = renderHook(() => useConnectionFilter());
    expect(result.current.connectionPersonas).toBe(state.all);
    act(() => result.current.setConnectionFilter("local"));
    expect(state.query).toHaveBeenLastCalledWith({ runtimePlacement: "local" });
    expect(result.current.connectionPersonas).toEqual([{ _id: "local" }]);
    act(() => result.current.setConnectionFilter("cloud"));
    expect(state.query).toHaveBeenLastCalledWith({ runtimePlacement: "cloud" });
    act(() => result.current.setConnectionFilter("all"));
    expect(result.current.connectionPersonas).toBe(state.all);
  });
});
