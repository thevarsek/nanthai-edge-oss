import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {MemoryRouter} from "react-router-dom";
import {getFunctionName} from "convex/server";
import {TelegramChannelSettings} from "./TelegramChannelSettings";

const state = vi.hoisted(() => ({status: undefined as unknown, calls: vi.fn()}));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name=getFunctionName(ref);
    if (name==="channels/linking:status") return state.status;
    if (name==="personas/queries:list") return [{_id:"persona",displayName:"Writer"},{_id:"other",displayName:"Reviewer"}];
    if (name==="chat/queries:listChats") return [{_id:"chat",title:"Owned chat",participantSummary:[{personaId:"persona"}]},{_id:"group",title:"Group",participantSummary:[{personaId:"persona"},{personaId:"other"}]}];
    throw new Error(`Unexpected query ${name}`);
  },
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) => async (args: unknown) => {
    state.calls(getFunctionName(ref),args);return {url:"https://t.me/test_bot?start=test"};
  },
}));
const connected = {configured:true,identities:[{_id:"identity"}],bindings:[],grants:[],inbox:[],deliveries:[]};
beforeEach(()=>{state.calls.mockReset();state.status=connected;});
describe("Telegram settings",()=>{
  it("allows the complete multi-AI conversation without requiring a starter Persona",async()=>{
    render(<MemoryRouter><TelegramChannelSettings/></MemoryRouter>);
    expect(screen.getByRole("button",{name:"Create and connect"})).toBeEnabled();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText(/Connecting sends future AI replies/)).toBeVisible();
    fireEvent.click(screen.getByRole("button",{name:"Pick a conversation"}));
    expect(screen.getByRole("button",{name:"Owned chat"})).toBeVisible();
    fireEvent.click(screen.getByRole("button",{name:"Group"}));
    expect(state.calls).not.toHaveBeenCalled();
    expect(screen.queryByRole("button",{name:"Telegram Persona"})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Connect this conversation"}));
    await waitFor(()=>expect(state.calls).toHaveBeenCalledWith("channels/linking:selectConversation",{identityId:"identity",personaId:undefined,chatId:"group",deliverFutureReplies:true}));
  });
  it("uses ordinary NanthAI defaults when starting a new chat",async()=>{
    render(<MemoryRouter><TelegramChannelSettings/></MemoryRouter>);
    expect(state.calls).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Create and connect"}));
    await waitFor(()=>expect(state.calls).toHaveBeenCalledWith("channels/linking:selectConversation",{identityId:"identity",personaId:undefined,chatId:undefined,deliverFutureReplies:true}));
  });
  it("keeps an edited choice unsaved until connection and discards it on cancel",async()=>{
    state.status={...connected,bindings:[{_id:"binding",identityId:"identity",chatId:"group"}],connectedChatTitle:"Group"};
    render(<MemoryRouter><TelegramChannelSettings/></MemoryRouter>);
    fireEvent.click(screen.getByRole("button",{name:"Change conversation"}));
    expect(screen.getByRole("button",{name:"Connect this conversation"})).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:"Pick a conversation"}));
    fireEvent.click(screen.getByRole("button",{name:"Create a new conversation"}));
    expect(screen.getByRole("button",{name:"Create and connect"})).toBeEnabled();
    fireEvent.click(screen.getByRole("button",{name:"Cancel"}));
    expect(state.calls).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Change conversation"}));
    expect(screen.getByRole("button",{name:"Pick a conversation"})).toHaveTextContent("Group");
    fireEvent.click(screen.getByRole("button",{name:"Pick a conversation"}));
    fireEvent.click(screen.getByRole("button",{name:"Owned chat"}));
    expect(state.calls).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Connect this conversation"}));
    await waitFor(()=>expect(state.calls).toHaveBeenCalledWith("channels/linking:selectConversation",{identityId:"identity",personaId:undefined,chatId:"chat",deliverFutureReplies:true}));
  });
  it("shows the immutable claimant and confirms its owned grant",async()=>{
    state.status={...connected,identities:[],grants:[{id:"grant",claimantName:"Telegram Tester"}]};render(<MemoryRouter><TelegramChannelSettings/></MemoryRouter>);
    expect(screen.getByText(/Telegram Tester/)).toBeInTheDocument();fireEvent.click(screen.getByRole("button",{name:"Confirm account"}));
    await waitFor(()=>expect(state.calls).toHaveBeenCalledWith("channels/linking:confirm",{grantId:"grant"}));
  });
  it("separates retained-input retry from potentially duplicate delivery resend",async()=>{
    state.status={...connected,inbox:[{id:"input",status:"failed",error:"Runtime offline"}],deliveries:[{id:"delivery",part:0,status:"unknown"}]};render(<MemoryRouter><TelegramChannelSettings/></MemoryRouter>);
    fireEvent.click(screen.getByRole("button",{name:"Retry retained input"}));
    await waitFor(()=>expect(state.calls).toHaveBeenCalledWith("channels/controls:retryInput",{inboxId:"input"}));
    fireEvent.click(screen.getByRole("button",{name:"Resend — Telegram may receive a duplicate"}));
    await waitFor(()=>expect(state.calls).toHaveBeenCalledWith("channels/delivery_mutations:resend",{deliveryId:"delivery",acknowledgeDuplicateRisk:true}));
  });
  it("shows loading and unconfigured states without an unusable connection action",()=>{
    state.status=undefined;const {rerender}=render(<MemoryRouter><TelegramChannelSettings/></MemoryRouter>);expect(screen.getByText(/Loading/)).toBeInTheDocument();
    state.status={...connected,configured:false};rerender(<MemoryRouter><TelegramChannelSettings/></MemoryRouter>);expect(screen.getByText(/Not configured/)).toBeInTheDocument();expect(screen.queryByRole("button",{name:"Connect Telegram"})).toBeNull();
  });
});
