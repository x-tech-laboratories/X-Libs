import { describe, expect, it } from "vitest";

import { convert, format_measure, to_shown, to_stored } from "../src/units.ts";

describe("units", () => {
  it("converts within a quantity and refuses across quantities", () => {
    expect(convert(100, "kg", "lb")).toBeCloseTo(220.462, 3);
    expect(convert(1, "mi", "km")).toBeCloseTo(1.609344, 6);
    expect(convert(1000, "kJ", "kcal")).toBeCloseTo(239.006, 3);
    expect(() => convert(1, "kg", "cm")).toThrow("cannot convert kg to cm");
  });

  it("goes between the stored unit and the one shown", () => {
    expect(to_shown(2.54, "in")).toBeCloseTo(1, 6);
    expect(to_stored(225, "lb")).toBeCloseTo(102.058, 3);
    expect(to_stored(to_shown(80, "lb"), "lb")).toBeCloseTo(80, 9);
  });

  it("formats a stored value in the unit shown without trailing zeros", () => {
    expect(format_measure(100, "kg")).toBe("100 kg");
    expect(format_measure(102.0583, "lb", 0)).toBe("225 lb");
  });
});
