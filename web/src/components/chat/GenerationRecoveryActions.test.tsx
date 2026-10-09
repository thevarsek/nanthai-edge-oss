import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { GenerationRecoveryActions } from "./GenerationRecoveryActions";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
});

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
describe("server-projected recovery actions", () => {
  it("opens credits safely and invokes the existing model picker", () => {
    const change = vi.fn();
    render(<MemoryRouter><GenerationRecoveryActions recovery={{actions:["openrouter_credits", "change_model"]}} onChangeModel={change} /></MemoryRouter>);
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://openrouter.ai/settings/credits");
    expect(screen.getByRole("link")).toHaveAttribute("rel", "noopener noreferrer");
    fireEvent.click(screen.getByRole("button"));
    expect(change).toHaveBeenCalledOnce();
    expect(screen.queryByText("generation_recovery_settings")).not.toBeInTheDocument();
  });
  it("opens a focused connection dialog without leaving the chat", () => {
    render(<MemoryRouter><GenerationRecoveryActions recovery={{actions:["reconnect_openrouter"]}} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", {name:"generation_recovery_reconnect"}));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("button", {name:"connect_openrouter"})).toBeVisible();
    fireEvent.click(screen.getByRole("button", {name:"done"}));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("ignores unknown or absent actions", () => {
    render(<MemoryRouter><GenerationRecoveryActions recovery={{reason:null,actions:["future_action"]}} /></MemoryRouter>);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
