import { describe, expect, it } from "vitest";

import { escape_help, escape_label_value, format_sample_value, metric_name, render_metrics } from "../../src/server/prometheus.ts";

describe("prometheus text format", () => {
  it("writes each family's help and type, then a line per sample with its labels in order", () => {
    const text = render_metrics([
      { name: "app_up", help: "Whether it is up", type: "gauge", samples: [{ labels: { monitor: "cpu", state: "online" }, value: 1 }] },
      { name: "app_runs", help: "Runs so far", type: "counter", samples: [{ value: 3, suffix: "_total" }] },
    ]);
    expect(text).toBe([
      "# HELP app_up Whether it is up",
      "# TYPE app_up gauge",
      "app_up{monitor=\"cpu\",state=\"online\"} 1",
      "# HELP app_runs Runs so far",
      "# TYPE app_runs counter",
      "app_runs_total 3",
      "",
    ].join("\n"));
  });

  it("keeps a family with no samples, so a scraper still learns its type", () => {
    expect(render_metrics([{ name: "empty", help: "Nothing yet", type: "gauge", samples: [] }])).toBe("# HELP empty Nothing yet\n# TYPE empty gauge\n");
  });

  it("escapes label values and help text as the format asks", () => {
    expect(escape_label_value("a\\b\"c\nd")).toBe("a\\\\b\\\"c\\nd");
    expect(escape_help("one\\two\nthree \"quoted\"")).toBe("one\\\\two\\nthree \"quoted\"");
  });

  it("makes names valid, guarding a leading digit", () => {
    expect(metric_name("disk.used-bytes")).toBe("disk_used_bytes");
    expect(metric_name("9lives")).toBe("_9lives");
    expect(metric_name("ns:metric")).toBe("ns:metric");
    expect(render_metrics([{ name: "m", help: "h", type: "gauge", samples: [{ labels: { "bad-name": "x" }, value: 0 }] }])).toContain("m{bad_name=\"x\"} 0");
  });

  it("writes infinities and not-a-number in the format's own words", () => {
    expect(format_sample_value(Infinity)).toBe("+Inf");
    expect(format_sample_value(-Infinity)).toBe("-Inf");
    expect(format_sample_value(Number.NaN)).toBe("NaN");
    expect(format_sample_value(0.5)).toBe("0.5");
  });
});
