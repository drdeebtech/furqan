import { describe, it, expect } from "vitest";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { paginationIcons } from "./pagination-direction";

describe("paginationIcons — pagination arrows follow reading direction", () => {
  it("Arabic (RTL): previous points right, next points left", () => {
    const { PrevIcon, NextIcon } = paginationIcons("ar");
    expect(PrevIcon).toBe(ChevronRight);
    expect(NextIcon).toBe(ChevronLeft);
  });

  it("English (LTR): previous points left, next points right", () => {
    const { PrevIcon, NextIcon } = paginationIcons("en");
    expect(PrevIcon).toBe(ChevronLeft);
    expect(NextIcon).toBe(ChevronRight);
  });

  it("defaults to LTR direction for any non-Arabic language", () => {
    const { PrevIcon, NextIcon } = paginationIcons("fr");
    expect(PrevIcon).toBe(ChevronLeft);
    expect(NextIcon).toBe(ChevronRight);
  });
});
