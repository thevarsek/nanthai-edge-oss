import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FundingNotice } from "./FundingNotice";
import { selectedFundingGuidance } from "@/lib/modelFunding";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
const guidance = {code:"no_credits", freeModelId:"free", actions:["choose_free_model", "openrouter_credits"]};
describe("funding guidance", () => {
  it("offers explicit selection and a safe credits link without changing the draft", () => {
    const select = vi.fn();
    render(<><input aria-label="Draft" defaultValue="Keep this question"/><FundingNotice guidance={guidance} onChooseModel={select}/></>);
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("funding_choose_free"));
    expect(select).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Draft")).toHaveValue("Keep this question");
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://openrouter.ai/settings/credits");
  });
  it("keeps privacy as an explicit action and ignores future codes", () => {
    const {rerender} = render(<FundingNotice guidance={{code:"free_zdr_unavailable",actions:["privacy_settings"]}} onChooseModel={vi.fn()}/>);
    fireEvent.click(screen.getByText("funding_privacy"));
    expect(navigate).toHaveBeenCalledWith("/app/settings#chat-defaults");
    rerender(<FundingNotice guidance={{code:"future",actions:["privacy_settings"]}} onChooseModel={vi.fn()}/>);
    expect(screen.queryByTestId("funding-notice")).not.toBeInTheDocument();
  });
  it("explains ZDR incompatibility without a credits link", () => {
    render(<FundingNotice guidance={{code:"zdr_incompatible",actions:["choose_free_model","privacy_settings"]}} onChooseModel={vi.fn()}/>);
    expect(screen.getByText("funding_zdr_incompatible")).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("funding_privacy")).toBeVisible();
  });
  it("ignores local runtime personas but detects a later cloud participant", () => {
    const models = [{modelId:"paid",fundingGuidance:guidance}];
    const local = [{_id:"local",runtimePlacement:"local"}];
    expect(selectedFundingGuidance([{modelId:"paid",personaId:"local"}],models,local)).toBeUndefined();
    expect(selectedFundingGuidance([{modelId:"paid",personaId:"local"},{modelId:"paid"}],models,local)).toEqual(guidance);
  });
});
