import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntegrationLogo } from "./IntegrationLogo";

describe("IntegrationLogo", () => {
  it("renders known integration asset paths", () => {
    render(<IntegrationLogo slug="gmail" />);

    expect(screen.getByAltText("gmail logo")).toHaveAttribute(
      "src",
      "/integrations/integration_gmail.png",
    );
  });

  it("retries image loading when the slug changes after an image failure", () => {
    const { rerender } = render(<IntegrationLogo slug="unknown-one" />);
    fireEvent.error(screen.getByAltText("unknown-one logo"));

    expect(screen.queryByAltText("unknown-one logo")).not.toBeInTheDocument();

    rerender(<IntegrationLogo slug="gmail" />);

    expect(screen.getByAltText("gmail logo")).toBeInTheDocument();
  });

  it("renders generated initials fallback for missing hyphenated integrations", () => {
    render(<IntegrationLogo slug="custom-service" size={40} className="rounded" />);

    fireEvent.error(screen.getByAltText("custom-service logo"));

    const fallback = screen.getByLabelText("custom-service logo");
    expect(fallback).toHaveTextContent("CS");
    expect(fallback).toHaveClass("rounded");
    expect(fallback).toHaveStyle({ width: "40px", height: "40px" });
  });
});
