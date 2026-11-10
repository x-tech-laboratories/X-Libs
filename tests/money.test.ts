import { describe, expect, it } from "vitest";

import { currency_options, format_money, is_currency_code, money_decimals, money_step, round_money, sum_money } from "../src/money.ts";

describe("money", () => {
  it("keeps the places within what Intl takes, two unless set", () => {
    expect(money_decimals(undefined)).toBe(2);
    expect(money_decimals("abc")).toBe(2);
    expect(money_decimals(-1)).toBe(0);
    expect(money_decimals(25)).toBe(20);
    expect(money_decimals(3.7)).toBe(3);
  });

  it("rounds to the places, never to -0, and reads text and blanks", () => {
    expect(round_money(0.1 + 0.2)).toBe(0.3);
    expect(round_money("12.345", 2)).toBe(12.35);
    expect(round_money(1234.5, 0)).toBe(1235);
    expect(round_money(-1234.5, 0)).toBe(-1235);
    expect(Object.is(round_money(-0.001), 0)).toBe(true);
    expect(round_money("")).toBe(0);
    expect(round_money(null)).toBe(0);
  });

  it("steps by the smallest amount and adds without float noise", () => {
    expect(money_step(2)).toBe(0.01);
    expect(money_step(0)).toBe(1);
    expect(money_step(3)).toBe(0.001);
    expect(sum_money([0.1, 0.2, 0.3])).toBe(0.6);
  });

  it("formats in a currency and locale, and falls back on a code Intl refuses", () => {
    expect(format_money(1200, { currency: "USD", locale: "en-US" })).toBe("$1,200.00");
    expect(format_money(-85.5, { currency: "USD", locale: "en-US", decimals: 0 })).toBe("-$86");
    expect(format_money(-0.001, { currency: "USD", locale: "en-US" })).toBe("$0.00");
    expect(format_money(3.5, { currency: "US", locale: "en-US" })).toBe("3.50 US");
  });

  it("knows the currency codes and names them for a select", () => {
    expect(is_currency_code("JMD")).toBe(true);
    expect(is_currency_code("jmd")).toBe(false);
    expect(is_currency_code("ZZZ")).toBe(false);
    expect(currency_options("en-US")).toContainEqual(["JMD", "JMD · Jamaican Dollar"]);
  });
});
