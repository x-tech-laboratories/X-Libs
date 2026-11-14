import { describe, expect, it } from "vitest";

import { convert, format_change, format_grams, format_measure, format_number, from_grams, to_grams, to_shown, to_stored } from "../src/units.ts";

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

  it("shows grams in g, mg or µg and reads them back", () => {
    expect(from_grams(0.0023, "mg")).toBeCloseTo(2.3, 9);
    expect(from_grams(0.00002, "µg")).toBeCloseTo(20, 9);
    expect(to_grams(400, "µg")).toBeCloseTo(0.0004, 12);
    expect(to_grams(from_grams(0.074, "mg"), "mg")).toBeCloseTo(0.074, 12);
  });

  it("formats grams to a tenth, and mg and µg whole from 10 up", () => {
    expect(format_grams(6.5, "g")).toBe("6.5 g");
    expect(format_grams(6, "g")).toBe("6 g");
    expect(format_grams(0.12, "mg")).toBe("120 mg");
    expect(format_grams(0.0047, "mg")).toBe("4.7 mg");
    expect(format_grams(0.0000024, "µg")).toBe("2.4 µg");
    expect(format_grams(0, "mg")).toBe("0 mg");
  });

  it("formats a stored value in the unit shown without trailing zeros", () => {
    expect(format_measure(100, "kg")).toBe("100 kg");
    expect(format_measure(102.0583, "lb", 0)).toBe("225 lb");
  });

  it("prints whole numbers whole and the rest to one decimal", () => {
    expect(format_number(80)).toBe("80");
    expect(format_number(80.04)).toBe("80");
    expect(format_number(80.25)).toBe("80.3");
    expect(format_number(1234.5)).toBe("1234.5");
    expect(format_number(-0.04)).toBe("0");
    expect(format_number(Number.NaN)).toBe("0");
    expect(format_number(2.345, 2)).toBe("2.35");
  });

  it("signs a change, leaving a change that rounds to nothing bare", () => {
    expect(format_change(1.5, "kg")).toBe("+1.5 kg");
    expect(format_change(-0.5, "kg")).toBe("-0.5 kg");
    expect(format_change(0.01, "kg")).toBe("0 kg");
    expect(format_change(2)).toBe("+2");
    expect(format_change(to_shown(1, "lb"), "lb")).toBe("+2.2 lb");
  });
});
