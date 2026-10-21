import { render, screen } from "@testing-library/react";
import { CircleDetailSkeleton } from "../CircleDetailSkeleton";

describe("CircleDetailSkeleton", () => {
  it("renders an accessible loading state matching the detail page grid", () => {
    const { container } = render(<CircleDetailSkeleton />);
    const loadingState = screen.getByLabelText("Loading…");
    const cards = container.querySelectorAll(".card");

    expect(loadingState).toHaveAttribute("aria-busy", "true");
    expect(cards).toHaveLength(4);
    expect(cards[0]).toHaveStyle({ gridColumn: "1 / -1" });
    expect(cards[1]).toHaveStyle({ gridColumn: "1 / -1" });
  });
});