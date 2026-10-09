import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { VoiceCloningRequest } from "@/types/voiceCloning";
import { VoiceCloningComposer } from "./VoiceCloningComposer";

vi.mock("@/hooks/useSharedData", () => ({ useModelSummaries: (options: { voiceCloning: { requireZdr: boolean } }) => [
  { modelId: "ordinary", name: "Ordinary speech", generationCapabilities: { speech: true }, mediaCapabilities: { speech: { maxAudioReferences: 0, maxZdrAudioReferences: 0 } } },
  { modelId: "seed", name: "Seed speech", generationCapabilities: { speech: true }, mediaCapabilities: { speech: { maxAudioReferences: 3, maxZdrAudioReferences: 1 } } },
  { modelId: "fish-audio/s2.1-pro", name: "Fish Audio S2.1 Pro", generationCapabilities: { speech: true }, mediaCapabilities: { speech: { maxAudioReferences: 1, maxZdrAudioReferences: 1 } } },
].filter(model => (options.voiceCloning.requireZdr ? model.mediaCapabilities.speech.maxZdrAudioReferences : model.mediaCapabilities.speech.maxAudioReferences) > 0) }));

function Harness({ requireZdr = false, initiallyOpen = true }: { requireZdr?: boolean; initiallyOpen?: boolean }) {
  const [value, onChange] = useState<VoiceCloningRequest>();
  const [open, setOpen] = useState(initiallyOpen);
  return <>
    <button onClick={() => setOpen(true)}>Configure voice</button>
    {open && <VoiceCloningComposer attachments={[1, 2, 3].map((index) => ({ storageId: `audio${index}` as Id<"_storage">,
      type: "audio", name: `reference-${index}.wav`, mimeType: "audio/wav", sizeBytes: 100 }))}
      value={value} onChange={onChange} onClose={() => setOpen(false)} onChoose={vi.fn()} onRecord={vi.fn()} disabled={false} requireZdr={requireZdr} />}
    <output aria-label="Request">{JSON.stringify(value)}</output>
  </>;
}

describe("voice cloning composer", () => {
  it("labels the selected recording transcript and preserves the existing choose and record actions", () => {
    const onChoose = vi.fn();
    const onRecord = vi.fn();
    render(<VoiceCloningComposer attachments={[{ storageId: "audio1" as Id<"_storage">, type: "audio", name: "My recording.m4a", mimeType: "audio/mp4" }]}
      value={{ modelId: "fish-audio/s2.1-pro", permissionConfirmed: true, references: [{ storageId: "audio1" as Id<"_storage">, transcript: "Hello, this is my voice." }] }}
      onChange={vi.fn()} onClose={vi.fn()} onChoose={onChoose} onRecord={onRecord} disabled={false} requireZdr={false} />);
    expect(screen.getByText("Optional reference transcript")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Transcript for My recording.m4a" })).toHaveValue("Hello, this is my voice.");
    expect(screen.getByRole("checkbox", { name: /My recording.m4a/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "I have permission to use these voices for this request." })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Choose recordings" }));
    fireEvent.click(screen.getByRole("button", { name: "Record a reference" }));
    expect(onChoose).toHaveBeenCalledOnce();
    expect(onRecord).toHaveBeenCalledOnce();
  });
  it("records request-specific selection and one permission confirmation, resetting permission when a reference changes", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", {name: "Speech model"}));
    fireEvent.click(screen.getByRole("button", {name: "Seed speech"}));
    fireEvent.click(screen.getByRole("checkbox", { name: /reference-1.wav/ }));
    fireEvent.click(screen.getByLabelText("I have permission to use these voices for this request."));
    expect(screen.getByLabelText("Request")).toHaveTextContent('"permissionConfirmed":true');
    fireEvent.change(screen.getByLabelText("Transcript for reference-1.wav"), { target: { value: "My sample" } });
    expect(screen.getByLabelText("Request")).toHaveTextContent('"permissionConfirmed":false');
    expect(screen.getByLabelText("Request")).toHaveTextContent('"transcript":"My sample"');
    fireEvent.click(screen.getByRole("button", { name: "Remove voice cloning" }));
    expect(screen.getByLabelText("Request")).toBeEmptyDOMElement();
  });
  it("searches the backend eligible catalogue and follows shared ZDR reference counts", () => {
    render(<Harness requireZdr />);
    fireEvent.click(screen.getByRole("button", {name: "Speech model"}));
    expect(screen.queryByRole("button", {name: "Ordinary speech"})).toBeNull();
    fireEvent.change(screen.getByRole("textbox", {name: "Search"}), { target: {value: "Seed"} });
    fireEvent.click(screen.getByRole("button", {name: "Seed speech"}));
    fireEvent.click(screen.getByRole("checkbox", { name: /reference-1.wav/ }));
    expect(screen.getByLabelText("reference-2.wav")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /reference-1.wav/ })).toBeEnabled();
  });
  it("keeps selection in a dismissible drawer and restores it when reopened", () => {
    render(<Harness initiallyOpen={false} />);
    const trigger = screen.getByRole("button", { name: "Configure voice" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Clone a voice" })).toHaveAttribute("aria-modal", "true");
    const close = screen.getByRole("button", { name: "Close" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Done" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Speech model" }));
    const search = screen.getByRole("textbox", { name: "Search" });
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Clone a voice" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Search" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Speech model" }));
    fireEvent.click(screen.getByRole("button", { name: "Seed speech" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /reference-1.wav/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "I have permission to use these voices for this request." }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    expect(screen.getByRole("checkbox", { name: /reference-1.wav/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "I have permission to use these voices for this request." })).toBeChecked();
    fireEvent.keyDown(screen.getByRole("button", { name: "Close" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
