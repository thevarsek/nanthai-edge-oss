import type { FormEvent } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteAccountSection, NavRow, SettingsRow } from "./SettingsHelpers";

const { deleteAccount, navigate, signOut, userDelete } = vi.hoisted(() => ({
  deleteAccount: vi.fn(),
  navigate: vi.fn(),
  signOut: vi.fn(),
  userDelete: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useAction: () => deleteAccount,
}));

vi.mock("@clerk/react", () => ({
  useClerk: () => ({ signOut }),
  useUser: () => ({ user: { delete: userDelete } }),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("SettingsHelpers", () => {
  beforeEach(() => {
    deleteAccount.mockReset();
    deleteAccount.mockResolvedValue(null);
    navigate.mockReset();
    signOut.mockReset();
    signOut.mockResolvedValue(null);
    userDelete.mockReset();
    userDelete.mockResolvedValue(undefined);
  });

  it("does not submit an enclosing form for clickable settings rows", () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    const onNav = vi.fn();
    const onRow = vi.fn();

    render(
      <MemoryRouter>
        <form onSubmit={onSubmit}>
          <NavRow label="Open profile" onClick={onNav} />
          <SettingsRow onClick={onRow}>
            <span>Open defaults</span>
          </SettingsRow>
        </form>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Open profile/i }));
    fireEvent.click(screen.getByRole("button", { name: /Open defaults/i }));

    expect(onNav).toHaveBeenCalledTimes(1);
    expect(onRow).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("purges Convex before deleting the Clerk user during account deletion", async () => {
    const calls: string[] = [];
    deleteAccount.mockImplementation(async () => {
      calls.push("purgeConvex");
      return null;
    });
    userDelete.mockImplementation(async () => {
      calls.push("deleteClerk");
    });

    render(
      <MemoryRouter>
        <DeleteAccountSection />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "delete_account" }));
    fireEvent.click(screen.getByRole("button", { name: "delete_my_account" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));

    expect(calls).toEqual(["purgeConvex", "deleteClerk"]);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("falls back to sign-out when Clerk deletion fails after Convex purge", async () => {
    const calls: string[] = [];
    deleteAccount.mockImplementation(async () => {
      calls.push("purgeConvex");
      return null;
    });
    userDelete.mockImplementation(async () => {
      calls.push("deleteClerk");
      throw new Error("delete failed");
    });
    signOut.mockImplementation(async () => {
      calls.push("signOut");
      return null;
    });

    render(
      <MemoryRouter>
        <DeleteAccountSection />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "delete_account" }));
    fireEvent.click(screen.getByRole("button", { name: "delete_my_account" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));

    expect(calls).toEqual(["purgeConvex", "deleteClerk", "signOut"]);
  });

  it("does not delete Clerk user when Convex purge fails", async () => {
    deleteAccount.mockRejectedValue(new Error("convex failed"));

    render(
      <MemoryRouter>
        <DeleteAccountSection />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "delete_account" }));
    fireEvent.click(screen.getByRole("button", { name: "delete_my_account" }));

    await waitFor(() => expect(screen.getAllByText("convex failed").length).toBeGreaterThan(0));

    expect(userDelete).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
