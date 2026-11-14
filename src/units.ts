// Measurements kept in one unit and shown in the one each person picks: weights in kilograms or pounds, lengths in
// centimetres or inches, distances in kilometres or miles, and energy in kilocalories or kilojoules; small amounts such
// as a food's nutrients kept in grams and shown in g, mg or µg; plain numbers and signed changes to a tenth.

// ── Units ────────────────────────────────────────────────────────────────────

export type MassUnit = "kg" | "lb";
export type LengthUnit = "cm" | "in";
export type DistanceUnit = "km" | "mi";
export type EnergyUnit = "kcal" | "kJ";
export type Unit = MassUnit | LengthUnit | DistanceUnit | EnergyUnit;

export type Quantity = "mass" | "length" | "distance" | "energy";

// How many of the stored unit, the first of each pair, make one of each unit.
const in_stored_unit: Record<Unit, { quantity: Quantity; factor: number }> = {
  kg: { quantity: "mass", factor: 1 },
  lb: { quantity: "mass", factor: 0.45359237 },
  cm: { quantity: "length", factor: 1 },
  in: { quantity: "length", factor: 2.54 },
  km: { quantity: "distance", factor: 1 },
  mi: { quantity: "distance", factor: 1.609344 },
  kcal: { quantity: "energy", factor: 1 },
  kJ: { quantity: "energy", factor: 1 / 4.184 },
};

export const stored_units: Record<Quantity, Unit> = { mass: "kg", length: "cm", distance: "km", energy: "kcal" };

// ── Converting ───────────────────────────────────────────────────────────────

export function convert(value: number, from: Unit, to: Unit): number {
  if (in_stored_unit[from].quantity !== in_stored_unit[to].quantity) throw new Error(`cannot convert ${from} to ${to}`);
  return (value * in_stored_unit[from].factor) / in_stored_unit[to].factor;
}

// A stored value, such as kilograms, in the unit shown.
export function to_shown(value: number, unit: Unit): number {
  return convert(value, stored_units[in_stored_unit[unit].quantity], unit);
}

// A value typed in the unit shown, back in the stored unit.
export function to_stored(value: number, unit: Unit): number {
  return convert(value, unit, stored_units[in_stored_unit[unit].quantity]);
}

// ── Grams ────────────────────────────────────────────────────────────────────

// Small amounts, such as a food's nutrients, kept in grams and shown in whichever reads best: sodium in mg, vitamin D in µg.
export type GramUnit = "g" | "mg" | "µg";

const per_gram: Record<GramUnit, number> = { g: 1, mg: 1000, "µg": 1_000_000 };

// Grams, in the unit shown.
export function from_grams(grams: number, unit: GramUnit): number {
  return grams * per_gram[unit];
}

// A value typed in the unit shown, back in grams.
export function to_grams(value: number, unit: GramUnit): number {
  return value / per_gram[unit];
}

// Grams in the unit shown with its label: grams to a tenth, mg and µg whole from 10 up and to a tenth below, such as
// "6.5 g", "120 mg" or "4.7 mg"; no trailing zeros.
export function format_grams(grams: number, unit: GramUnit): string {
  const exact = from_grams(grams, unit);
  const decimals = unit === "g" || Math.abs(exact) < 10 ? 1 : 0;
  const shown = Number(exact.toFixed(decimals));
  return `${shown.toLocaleString(undefined, { maximumFractionDigits: decimals })} ${unit}`;
}

// ── Showing ──────────────────────────────────────────────────────────────────

// A stored value in the unit shown with its label, such as "225 lb", to at most the given decimals and none trailing.
export function format_measure(value: number, unit: Unit, decimals = 1): string {
  const shown = Number(to_shown(value, unit).toFixed(decimals));
  return `${shown.toLocaleString(undefined, { maximumFractionDigits: decimals })} ${unit}`;
}

// A plain number such as a reading: whole when it rounds whole, otherwise to the given decimals, such as "80" or
// "80.5"; not localised, so it reads back as typed.
export function format_number(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return "0";
  const scale = 10 ** decimals;
  const rounded = Math.round(value * scale) / scale;
  // -0 prints as 0.
  if (Number.isInteger(rounded)) return String(rounded + 0);
  return rounded.toFixed(decimals);
}

// A difference with its sign and label, such as "+1.5 kg", "-0.5 kg" or "0 kg". A stored difference converts as a
// value does, since no unit here has an offset, so pass to_shown(change, unit) to show it in a person's unit.
export function format_change(change: number, label = "", decimals = 1): string {
  const text = format_number(change, decimals);
  const sign = change > 0 && text !== "0" ? "+" : "";
  return `${sign}${text} ${label}`.trim();
}
