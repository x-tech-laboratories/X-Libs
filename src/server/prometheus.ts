// Metrics in Prometheus' text exposition format: each family with its HELP and TYPE lines, then one line per sample
// with its labels, the names made valid and the label values and help text escaped as the format asks.

// ── Shapes ───────────────────────────────────────────────────────────────────

export type MetricType = "gauge" | "counter" | "untyped" | "summary" | "histogram";

export interface Sample {
  labels?: Record<string, string>;
  value: number;
  // Added after the name, such as "_total" or "_bucket"; nothing unless set.
  suffix?: string;
}

export interface MetricFamily {
  name: string;
  help: string;
  type: MetricType;
  samples: Sample[];
}

// ── Names and escapes ────────────────────────────────────────────────────────

// A metric name with every character the format refuses turned into "_", and a leading digit guarded by one.
export function metric_name(text: string): string {
  const name = text.replace(/[^a-zA-Z0-9_:]/g, "_");
  return /^[0-9]/.test(name) ? `_${name}` : name;
}

// A label name, which may not hold the colons a metric name may.
export function label_name(text: string): string {
  const name = text.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[0-9]/.test(name) ? `_${name}` : name;
}

// A label value with its backslashes, quotes and newlines escaped.
export function escape_label_value(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("\n", "\\n");
}

// Help text with its backslashes and newlines escaped; quotes stay as they are.
export function escape_help(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll("\n", "\\n");
}

// A sample's value, with the format's own words for infinities and not-a-number.
export function format_sample_value(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "+Inf";
  if (value === -Infinity) return "-Inf";
  return String(value);
}

// ── Rendering ────────────────────────────────────────────────────────────────

// The labels in braces in the order given, or nothing when there are none.
export function format_labels(labels: Record<string, string> | undefined): string {
  const entries = Object.entries(labels ?? {});
  if (entries.length === 0) return "";
  return `{${entries.map(([name, value]) => `${label_name(name)}="${escape_label_value(value)}"`).join(",")}}`;
}

export function render_family(family: MetricFamily): string[] {
  const name = metric_name(family.name);
  const lines = [`# HELP ${name} ${escape_help(family.help)}`, `# TYPE ${name} ${family.type}`];
  for (const sample of family.samples) {
    lines.push(`${name}${sample.suffix ?? ""}${format_labels(sample.labels)} ${format_sample_value(sample.value)}`);
  }
  return lines;
}

// The whole page a scraper reads, ending in a newline as the format asks.
export function render_metrics(families: MetricFamily[]): string {
  return `${families.flatMap(render_family).join("\n")}\n`;
}

// The content type a scrape is answered with.
export const metrics_content_type = "text/plain; version=0.0.4; charset=utf-8";
