// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { Badge } from "../src/web/react/badges.tsx";

test("a badge shows its text with its tone as a class", () => {
  render(<Badge tone="ok">Healthy</Badge>);

  expect(screen.getByText("Healthy").className).toContain("ok");
});
