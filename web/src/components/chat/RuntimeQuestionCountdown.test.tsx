import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RuntimeQuestionCountdown } from "./RuntimeQuestionCountdown";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, args?: { time: string }) => `${key}${args?.time ? `:${args.time}` : ""}` }) }));
afterEach(() => vi.useRealTimers());

it("counts down without announcing every second, then shows delivery and automatic source", () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  const view = render(<RuntimeQuestionCountdown deadline={3000} />);
  expect(screen.getByText("runtime_question_countdown:0:02")).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByText("runtime_question_delivering:0:00")).toBeInTheDocument();
  view.rerender(<RuntimeQuestionCountdown automatic />);
  expect(screen.getByRole("status")).toHaveTextContent("runtime_question_automatic");
  view.rerender(<RuntimeQuestionCountdown />);
  expect(view.container).toBeEmptyDOMElement();
});
