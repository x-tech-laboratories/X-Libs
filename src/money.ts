// Amounts of money kept to a set number of decimal places and shown in a currency, in the reader's language unless a
// locale is given.

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface MoneyFormat {
  // An ISO 4217 code such as "USD" or "JMD".
  currency: string;
  // A locale such as "en-US"; empty uses the reader's own.
  locale?: string;
  // How many decimal places amounts are kept and shown with; 2 unless set.
  decimals?: number;
}

// ── Places ───────────────────────────────────────────────────────────────────

// Intl takes 0 to 20 places, so anything else, such as a setting typed by hand, is brought within them.
export function money_decimals(decimals: unknown = 2): number {
  const places = Math.floor(Number(decimals));
  return Number.isFinite(places) ? Math.min(Math.max(places, 0), 20) : 2;
}

// Halves round away from zero, through a whole number of the smallest unit, so 0.1 + 0.2 comes back as 0.3 and never as -0.
export function round_money(value: unknown, decimals: unknown = 2): number {
  const scale = 10 ** money_decimals(decimals);
  const amount = Number(value) || 0;
  const rounded = (Math.sign(amount) * Math.round(Math.abs(amount) * scale)) / scale;
  return rounded === 0 ? 0 : rounded;
}

// The amount a field steps by, such as 0.01 for two places.
export function money_step(decimals: unknown = 2): number {
  return round_money(10 ** -money_decimals(decimals), decimals);
}

export function sum_money(values: readonly number[], decimals: unknown = 2): number {
  return round_money(values.reduce((total, value) => total + value, 0), decimals);
}

// ── Text ─────────────────────────────────────────────────────────────────────

// An unknown currency or locale, such as one half typed in a setting, falls back to the number and the code after it.
export function format_money(value: number, { currency, locale, decimals }: MoneyFormat): string {
  const places = money_decimals(decimals);
  const amount = round_money(value, places);
  try {
    return new Intl.NumberFormat(locale || undefined, { style: "currency", currency, minimumFractionDigits: places, maximumFractionDigits: places }).format(amount);
  } catch {
    return `${amount.toFixed(places)} ${currency}`.trim();
  }
}

export function is_currency_code(code: string): boolean {
  return /^[A-Z]{3}$/.test(code) && Intl.supportedValuesOf("currency").includes(code);
}

// Every currency as a code and its name in the reader's language, such as ["JMD", "JMD · Jamaican Dollar"], for a select.
export function currency_options(locale?: string): [code: string, label: string][] {
  const names = new Intl.DisplayNames(locale || undefined, { type: "currency" });
  return Intl.supportedValuesOf("currency").map((code) => [code, `${code} · ${names.of(code) ?? code}`]);
}
