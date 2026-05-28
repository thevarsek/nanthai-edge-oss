import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { mockState, renderRoute } from "@/test/criticalRoutesCoverage";
import { ManageFavoritesPage } from "./ManageFavoritesPage";

vi.mock("./ManageFavoritesHelpers", () => ({
  FavoriteEditorModal: ({ editing, onClose, onSaved }: {
    editing: { name: string } | null;
    onClose: () => void;
    onSaved: () => void;
  }) => (
    <div role="dialog" aria-label={editing ? `edit-${editing.name}` : "new-favorite"}>
      <button type="button" onClick={onSaved}>save favorite</button>
      <button type="button" onClick={onClose}>close favorite</button>
    </div>
  ),
}));

describe("ManageFavoritesPage shell behavior", () => {
  it("renders loading and empty states with stable navigation", () => {
    mockState.sharedData.favorites = undefined;

    const loading = renderRoute(<ManageFavoritesPage />);

    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    loading.unmount();

    mockState.sharedData.favorites = [];
    renderRoute(<ManageFavoritesPage />);

    expect(screen.getByText("no_favorites")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "back_to_settings" }));
    expect(mockState.navigate).toHaveBeenCalledWith("/app/settings");

    fireEvent.click(screen.getAllByRole("button", { name: "add_favorite" }).at(-1)!);
    expect(screen.getByRole("dialog", { name: "new-favorite" })).toBeInTheDocument();
  });

  it("covers participant avatars, edit close, reorder boundaries, and delete confirmation", async () => {
    mockState.sharedData.favorites = [
      {
        _id: "fav_a",
        name: "Alpha",
        sortOrder: 1,
        modelIds: ["openai/gpt-4.1"],
        participants: [
          { modelId: "openai/gpt-4.1", personaId: "persona_1", personaName: "Planner", personaEmoji: "P" },
          { modelId: "anthropic/claude-sonnet-4.5" },
          { modelId: "google/gemini-2.5-pro" },
        ],
      },
      {
        _id: "fav_b",
        name: "Beta",
        sortOrder: 2,
        modelIds: ["anthropic/claude-sonnet-4.5", "openai/gpt-4.1"],
      },
    ];

    renderRoute(<ManageFavoritesPage />);

    expect(screen.getByText("3 participants · Planner, claude-sonnet-4.5, gemini-2.5-pro")).toBeInTheDocument();

    fireEvent.click(screen.getAllByTitle("edit")[0]!);
    expect(screen.getByRole("dialog", { name: "edit-Alpha" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("close favorite"));
    expect(screen.queryByRole("dialog", { name: "edit-Alpha" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("reorder"));
    expect(screen.getAllByRole("button", { name: "move_favorite_up" })[0]).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "move_favorite_down" }).at(-1)).toBeDisabled();
    fireEvent.click(screen.getAllByRole("button", { name: "move_favorite_down" })[0]!);
    fireEvent.click(screen.getByText("done"));
    await waitFor(() => expect(mockState.mutation).toHaveBeenCalledWith({ orderedIds: ["fav_b", "fav_a"] }));

    fireEvent.click(screen.getAllByTitle("delete")[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "delete" }).at(-1)!);
    expect(mockState.mutation).toHaveBeenCalledWith({ favoriteId: "fav_a" });
  });
});
