import { describe, expect, it } from "vitest";

import { best_locale, create_translator, fill_placeholders, merge_messages, text_direction } from "../src/i18n.ts";

// ============================================================================
// Translating
// ============================================================================

describe("translator", () => {
  it("takes each key from the first catalog that has it and reads an unknown key as itself", () => {
    const t = create_translator<"next" | "previous" | "home">({ next: "Siguiente" }, { next: "Next", previous: "Previous" });

    expect(t("next")).toBe("Siguiente");
    expect(t("previous")).toBe("Previous");
    expect(t("home")).toBe("home");
  });

  it("fills placeholders and leaves one without a value as written", () => {
    const t = create_translator({ updated: "Updated {date} by {name}" });

    expect(t("updated", { date: "today" })).toBe("Updated today by {name}");
    expect(fill_placeholders("{count} pages", { count: 3 })).toBe("3 pages");
  });

  it("merges catalogs with the earlier ones winning", () => {
    expect(merge_messages({ a: "own" }, { a: "built in", b: "built in" })).toEqual({ a: "own", b: "built in" });
  });
});

// ============================================================================
// Choosing a locale
// ============================================================================

describe("best locale", () => {
  it("prefers an exact tag, then the same language, in the reader's order", () => {
    expect(best_locale(["en", "es", "pt-BR"], ["es-MX", "en"], "en")).toBe("es");
    expect(best_locale(["en", "pt-BR"], ["PT"], "en")).toBe("pt-BR");
    expect(best_locale(["en", "fr"], ["fr-CA", "fr"], "en")).toBe("fr");
  });

  it("falls back when nothing fits", () => {
    expect(best_locale(["en", "es"], ["ja", "zh-CN"], "en")).toBe("en");
  });

  it("knows which languages run right to left", () => {
    expect(text_direction("ar-EG")).toBe("rtl");
    expect(text_direction("he")).toBe("rtl");
    expect(text_direction("en")).toBe("ltr");
  });
});
