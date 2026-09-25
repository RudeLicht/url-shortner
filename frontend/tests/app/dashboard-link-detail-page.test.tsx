import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import LinkDetailPage from "@/app/(dashboard)/links/[id]/page";

describe("LinkDetailPage", () => {
  it("renders nothing (stub page)", () => {
    const { container } = render(<LinkDetailPage />);
    expect(container).toBeEmptyDOMElement();
  });
});
