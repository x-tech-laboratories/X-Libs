import { describe, expect, it } from "vitest";

import { bare_message_id, email_uri } from "../src/email_links.ts";

describe("email links", () => {
  it("takes the angle brackets and spaces off a Message-ID", () => {
    expect(bare_message_id("  <abc@example.org> ")).toBe("abc@example.org");
    expect(bare_message_id("abc@example.org")).toBe("abc@example.org");
  });

  it("links to the email by its bare Message-ID", () => {
    expect(email_uri("<abc@example.org>")).toBe("mid:abc@example.org");
  });
});
