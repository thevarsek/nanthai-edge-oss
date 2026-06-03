import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useOptimistic } from "./ChatDefaultsSection.utils";

describe("useOptimistic", () => {
  it("does not pin a pending edit when setting the current server value", async () => {
    const { result, rerender } = renderHook(
      ({ serverValue }: { serverValue: string }) => useOptimistic(serverValue),
      { initialProps: { serverValue: "dark" } },
    );

    act(() => result.current[1]("dark"));
    rerender({ serverValue: "light" });

    await waitFor(() => {
      expect(result.current[0]).toBe("light");
    });
  });
});
