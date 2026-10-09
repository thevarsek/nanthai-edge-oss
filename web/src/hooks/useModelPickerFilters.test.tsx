import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useModelPickerFilters } from "./useModelPickerFilters";
const save = vi.fn();
vi.mock("./usePreferenceBuffer", () => ({usePreferenceBuffer:()=>({updatePreferenceImmediate:save})}));
describe("funding picker defaults", () => {
  it("accepts a late confirmed-free projection until the user edits the filter", () => {
    const {result,rerender} = renderHook(({free}) => useModelPickerFilters({pickerFilterFree:free}), {initialProps:{free:false}});
    expect(result.current[0].has("free")).toBe(false);
    rerender({free:true});
    expect(result.current[0].has("free")).toBe(true);
    act(()=>result.current[1](new Set()));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({pickerFilterFree:false,pickerFilterExcludeFree:false}));
    rerender({free:true});
    expect(result.current[0].has("free")).toBe(false);
  });
});
