// Home Assistant's MQTT discovery: ids and topic levels made safe, the config topic each entity is announced on, the
// device it belongs to, and the device class and unit a reading's name implies.

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface DiscoveryDevice {
  identifiers: string[];
  name: string;
  manufacturer?: string;
  model?: string;
}

export type Component = "sensor" | "binary_sensor" | "switch" | "button" | "number" | "select" | "text";

// ── Names ────────────────────────────────────────────────────────────────────

// A value safe as one MQTT topic level and as a Home Assistant id: lowercase letters, digits, "_" and "-".
export function slug(value: unknown): string {
  return String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "unnamed";
}

// Where an entity's config is announced, such as "homeassistant/sensor/app_cpu/load/config".
export function discovery_topic(prefix: string, component: Component, node_id: string, object_id: string): string {
  return `${prefix}/${component}/${slug(node_id)}/${slug(object_id)}/config`;
}

// ── Traits ───────────────────────────────────────────────────────────────────

// Name endings that say what a reading measures, checked in order; the first match wins.
const trait_endings: [string[], Record<string, string>][] = [
  [["temp_c", "_celsius", "_temp", "temperature"], { device_class: "temperature", unit_of_measurement: "°C" }],
  [["_pct", "_percent"], { unit_of_measurement: "%" }],
  [["_seconds", "_secs"], { device_class: "duration", unit_of_measurement: "s" }],
  [["_ms"], { device_class: "duration", unit_of_measurement: "ms" }],
  [["_bytes"], { device_class: "data_size", unit_of_measurement: "B" }],
  [["_kb"], { device_class: "data_size", unit_of_measurement: "kB" }],
  [["_mb"], { device_class: "data_size", unit_of_measurement: "MB" }],
  [["_gb"], { device_class: "data_size", unit_of_measurement: "GB" }],
  [["_mbps"], { device_class: "data_rate", unit_of_measurement: "Mbit/s" }],
  [["_dbm"], { device_class: "signal_strength", unit_of_measurement: "dBm" }],
  [["_watts", "_w"], { device_class: "power", unit_of_measurement: "W" }],
  [["_per_sec"], { unit_of_measurement: "/s" }],
];

// The state class, and the device class and unit a reading's name implies, such as "_bytes" for a data size in B.
export function reading_traits(name: string): Record<string, string> {
  const lowered = name.toLowerCase();
  const traits: Record<string, string> = { state_class: "measurement" };
  const found = trait_endings.find(([endings]) => endings.some((ending) => lowered.endsWith(ending)));
  return found ? { ...traits, ...found[1] } : traits;
}
