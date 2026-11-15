import { describe, expect, test } from "vitest";

import {
  DATE_POINTS,
  date_point_label,
  matches_rule,
  resolve_point,
  resolve_rule,
  type DateRule,
} from "../src/date_ranges.ts";

// A Wednesday afternoon.
const now = new Date(2026, 10, 11, 14, 30);

const MINUTE_FORMAT = "YYYY-MM-DDTHH:mm";

function between(
  from: DateRule["from"],
  to: DateRule["to"],
  inclusivity: DateRule["inclusivity"] = "[]",
): DateRule {
  return { comparison: "is_between", from, to, inclusivity };
}

// ── Points ───────────────────────────────────────────────────────────────────

describe("resolving a point", () => {
  test("snaps days to their first and last minutes", () => {
    expect(resolve_point("start_of_next_day", now).format(MINUTE_FORMAT)).toBe(
      "2026-11-12T00:00",
    );
    expect(resolve_point("end_of_last_day", now).format(MINUTE_FORMAT)).toBe(
      "2026-11-10T23:59",
    );
  });

  test("takes now to the current minute", () => {
    expect(resolve_point("now", now).format(MINUTE_FORMAT)).toBe(
      "2026-11-11T14:30",
    );
  });

  test("starts weeks on Monday unless told otherwise", () => {
    expect(resolve_point("start_of_next_week", now).format(MINUTE_FORMAT)).toBe(
      "2026-11-16T00:00",
    );
    expect(resolve_point("end_of_next_week", now).format(MINUTE_FORMAT)).toBe(
      "2026-11-22T23:59",
    );
    expect(
      resolve_point("start_of_next_week", now, 0).format(MINUTE_FORMAT),
    ).toBe("2026-11-15T00:00");
  });

  test("ends months and years on their last day", () => {
    expect(resolve_point("end_of_this_month", now).format(MINUTE_FORMAT)).toBe(
      "2026-11-30T23:59",
    );
    expect(resolve_point("start_of_next_year", now).format(MINUTE_FORMAT)).toBe(
      "2027-01-01T00:00",
    );
  });

  test("lists and names every point", () => {
    expect(DATE_POINTS).toHaveLength(25);
    expect(date_point_label("start_of_next_day")).toBe("Start of tomorrow");
    expect(date_point_label("end_of_this_week")).toBe("End of this week");
    expect(date_point_label("now")).toBe("Now");
  });
});

// ── Rules ────────────────────────────────────────────────────────────────────

describe("resolving a rule", () => {
  test("leaves the side a before or after rule ignores open", () => {
    const before = resolve_rule(
      {
        comparison: "is_before",
        from: "now",
        to: "start_of_this_day",
        inclusivity: "[]",
      },
      now,
    );
    const after = resolve_rule(
      {
        comparison: "is_after",
        from: "end_of_this_month",
        to: "now",
        inclusivity: "[]",
      },
      now,
    );

    expect(before.from).toBeNull();
    expect(before.inclusivity).toBe("()");
    expect(after.to).toBeNull();
  });
});

// ── Matching ─────────────────────────────────────────────────────────────────

describe("matching a date", () => {
  const earlier_today = resolve_rule(between("start_of_this_day", "now"), now);
  const today = resolve_rule(
    between("start_of_this_day", "end_of_this_day"),
    now,
  );

  test("places a time by its minute", () => {
    expect(matches_rule("2026-11-11T09:00", earlier_today)).toBe(true);
    expect(matches_rule("2026-11-11T14:30", earlier_today)).toBe(true);
    expect(matches_rule("2026-11-11T14:31", earlier_today)).toBe(false);
  });

  test("places a plain date at the end of its day", () => {
    expect(matches_rule("2026-11-11", earlier_today)).toBe(false);
    expect(matches_rule("2026-11-11", today)).toBe(true);
  });

  test("keeps or leaves out the ends of a between rule", () => {
    const closed = resolve_rule(
      between("start_of_this_day", "start_of_next_day", "[]"),
      now,
    );
    const half_open = resolve_rule(
      between("start_of_this_day", "start_of_next_day", "[)"),
      now,
    );

    expect(matches_rule("2026-11-12T00:00", closed)).toBe(true);
    expect(matches_rule("2026-11-12T00:00", half_open)).toBe(false);
    expect(matches_rule("2026-11-11T00:00", half_open)).toBe(true);
  });

  test("leaves the point itself out of before and after", () => {
    const before_today = resolve_rule(
      {
        comparison: "is_before",
        from: "now",
        to: "start_of_this_day",
        inclusivity: "[]",
      },
      now,
    );
    const after_this_month = resolve_rule(
      {
        comparison: "is_after",
        from: "end_of_this_month",
        to: "now",
        inclusivity: "[]",
      },
      now,
    );

    expect(matches_rule("2026-11-10", before_today)).toBe(true);
    expect(matches_rule("2026-11-11T00:00", before_today)).toBe(false);
    expect(matches_rule("2026-11-30", after_this_month)).toBe(false);
    expect(matches_rule("2026-12-01T00:00", after_this_month)).toBe(true);
  });
});
