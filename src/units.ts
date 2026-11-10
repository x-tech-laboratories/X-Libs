// Measurements kept in one unit and shown in the one each person picks: weights in kilograms or pounds, lengths in
// centimetres or inches, distances in kilometres or miles, and energy in kilocalories or kilojoules.

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

// ── Showing ──────────────────────────────────────────────────────────────────

// A stored value in the unit shown with its label, such as "225 lb", to at most the given decimals and none trailing.
export function format_measure(value: number, unit: Unit, decimals = 1): string {
  const shown = Number(to_shown(value, unit).toFixed(decimals));
  return `${shown.toLocaleString(undefined, { maximumFractionDigits: decimals })} ${unit}`;
}
