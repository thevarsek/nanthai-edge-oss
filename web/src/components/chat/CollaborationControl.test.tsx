import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UseCollaborationReturn } from "@/hooks/useCollaboration";
import { CollaborationControl } from "./CollaborationControl";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === "collaboration_wave") {
        return `Wave ${String(values?.current)}/${String(values?.max)}`;
      }
      if (key === "collaboration_speakers_active") {
        return `${String(values?.names)} responding`;
      }
      return key;
    },
  }),
}));

function owner(
  overrides: Partial<UseCollaborationReturn> = {},
): UseCollaborationReturn {
  return {
    state: { behavior: "parallel", exchange: null },
    behavior: "parallel",
    isActive: false,
    isLoading: false,
    isUpdating: false,
    error: null,
    setBehavior: vi.fn(async () => true),
    stop: vi.fn(async () => undefined),
    ...overrides,
  };
}

function exchange(overrides: Record<string, unknown> = {}) {
  return {
    id: "exchange_1" as never,
    status: "waiting" as const,
    currentWave: 2,
    maxWaves: 5,
    activeSpeakers: [{
      displayName: "Architect",
    }],
    pendingInputCount: 0,
    ...overrides,
  };
}

describe("CollaborationControl", () => {
  it("stays hidden in Parallel mode", () => {
    render(<CollaborationControl collaboration={owner()} autonomousActive={false} />);
    expect(screen.queryByText("collaboration_label")).not.toBeInTheDocument();
  });

  it("shows canonical wave state without a second Stop control", () => {
    render(
      <CollaborationControl
        collaboration={owner({
          behavior: "collaboration",
          isActive: true,
          state: {
            behavior: "collaboration",
            exchange: exchange({ pendingInputCount: 2 }),
          },
        })}
        autonomousActive={false}
      />,
    );

    expect(screen.getByText("Wave 2/5")).toBeInTheDocument();
    expect(screen.getByText("Architect responding")).toBeInTheDocument();
    expect(screen.getByText("collaboration_input_queued")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /stop/i })).not.toBeInTheDocument();
  });

  it("shows terminal silence in the activity panel and lets the user dismiss it", () => {
    render(
      <CollaborationControl
        collaboration={owner({
          behavior: "collaboration",
          state: {
            behavior: "collaboration",
            exchange: exchange({
              status: "silent",
              activeSpeakers: [],
              terminalReason: "nothing_substantive",
              completedAt: Date.now(),
            }),
          },
        })}
        autonomousActive={false}
      />,
    );

    expect(screen.getByText("collaboration_floor_returned")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "dismiss" }));
    expect(screen.queryByText("collaboration_floor_returned")).not.toBeInTheDocument();
  });

  it("shows scheduling errors inside the activity panel", () => {
    render(
      <CollaborationControl
        collaboration={owner({
          behavior: "collaboration",
          state: {
            behavior: "collaboration",
            exchange: exchange({
              status: "failed",
              activeSpeakers: [],
              terminalReason: "scheduler_output_truncated",
              error: "Could not choose a participant.",
              completedAt: Date.now(),
            }),
          },
        })}
        autonomousActive={false}
      />,
    );

    expect(screen.getByText("collaboration_scheduler_retry")).toBeInTheDocument();
    expect(screen.getByText("Could not choose a participant.")).toBeInTheDocument();
  });
});
