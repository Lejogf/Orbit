// Receipt parsing and fair bill splitting.
//
// OCR runs on the device (so the photo never leaves the phone); this module
// turns its noisy text into line items, then splits them. The split rule is the
// one people actually use at a table: you pay for what you had, shared dishes
// divide evenly between whoever shared them, and tax and tip follow each
// person's share of the food. Rounding never loses or invents a cent.

export interface ReceiptItem {
  id: string;
  name: string;
  /** Line total in cents (quantity already applied). */
  cents: number;
  quantity: number;
}

export interface ParsedReceipt {
  merchant: string | null;
  items: ReceiptItem[];
  subtotalCents: number | null;
  taxCents: number | null;
  tipCents: number | null;
  totalCents: number | null;
  /** True when the items add up to the printed subtotal (or total less tax/tip). */
  reconciles: boolean;
}

// A price at the end of a line: 12.99, $12.99, 1,299.00, 12,99 (some OCR output).
const PRICE_AT_END = /(-?\$?\s?\d{1,3}(?:[,]\d{3})*(?:[.,]\d{2}))\s*[A-Z]?$/;

const SUMMARY_PATTERNS: [keyof Pick<ParsedReceipt, 'subtotalCents' | 'taxCents' | 'tipCents' | 'totalCents'>, RegExp][] = [
  ['subtotalCents', /\bsub\s*-?\s*total\b/i],
  ['taxCents', /\b(tax|hst|gst|vat)\b/i],
  ['tipCents', /\b(tip|gratuity|service\s*charge)\b/i],
  ['totalCents', /\b(total|amount\s*due|balance\s*due|grand\s*total)\b/i],
];

/** Lines that carry a number but are not food. */
const NOISE = /\b(visa|mastercard|amex|change|cash|card\s*#|auth|approval|ref|table|server|guests?|tel|phone|receipt|order\s*#|x{3,}|\d{2}\/\d{2}\/\d{2,4})\b/i;

export function parsePrice(raw: string): number | null {
  const cleaned = raw.replace(/[$\s]/g, '');
  // "1,299.00" -> thousands separator; "12,99" -> decimal comma.
  const normalised = /,\d{2}$/.test(cleaned) && !cleaned.includes('.')
    ? cleaned.replace(',', '.')
    : cleaned.replace(/,/g, '');
  const value = Number(normalised);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

function tidyName(raw: string): string {
  return raw
    .replace(/^\d+\s*[xX@]?\s+/, '') // leading quantity
    .replace(/[^\p{L}\p{N}&'’ .\-/]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function quantityOf(raw: string): number {
  const match = raw.match(/^\s*(\d{1,2})\s*[xX@]?\s+\D/);
  const qty = match ? Number(match[1]) : 1;
  return qty >= 1 && qty <= 20 ? qty : 1;
}

export function parseReceiptText(text: string): ParsedReceipt {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const result: ParsedReceipt = {
    merchant: null,
    items: [],
    subtotalCents: null,
    taxCents: null,
    tipCents: null,
    totalCents: null,
    reconciles: false,
  };

  // The first line with letters and no price is usually the restaurant name.
  const header = lines.find((l) => /[a-z]{3,}/i.test(l) && !PRICE_AT_END.test(l));
  result.merchant = header ? tidyName(header) || null : null;

  for (const line of lines) {
    const priceMatch = line.match(PRICE_AT_END);
    if (!priceMatch) continue;
    const cents = parsePrice(priceMatch[1]!);
    if (cents === null) continue;

    const label = line.slice(0, priceMatch.index).trim();

    // Subtotal is listed first, so "Subtotal" never falls through to /total/.
    const summary = SUMMARY_PATTERNS.find(([, pattern]) => pattern.test(label));
    if (summary) {
      const [key] = summary;
      // The last "total" on a receipt is the one that was paid.
      if (result[key] === null || key === 'totalCents') result[key] = cents;
      continue;
    }

    if (NOISE.test(label) || cents <= 0) continue;
    const name = tidyName(label);
    if (name.length < 2) continue;

    result.items.push({
      id: `item-${result.items.length + 1}`,
      name,
      cents,
      quantity: quantityOf(label),
    });
  }

  const itemsSum = result.items.reduce((s, i) => s + i.cents, 0);
  const expectedSubtotal =
    result.subtotalCents ??
    (result.totalCents !== null
      ? result.totalCents - (result.taxCents ?? 0) - (result.tipCents ?? 0)
      : null);
  result.reconciles = expectedSubtotal !== null && Math.abs(expectedSubtotal - itemsSum) <= 1;

  return result;
}

// --- splitting ---

export interface SplitPerson {
  id: string;
  name: string;
}

export interface SplitInput {
  items: ReceiptItem[];
  people: SplitPerson[];
  /** itemId -> the people who shared it. An unassigned item is shared by everyone. */
  assignments: Record<string, string[]>;
  taxCents: number;
  tipCents: number;
  /** 'proportional' follows each share of the food; 'even' divides equally. */
  extrasMode?: 'proportional' | 'even';
}

export interface PersonShare {
  personId: string;
  name: string;
  itemsCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  items: { name: string; cents: number }[];
}

/**
 * Divides `total` into parts proportional to `weights`, using largest-remainder
 * rounding so the parts always sum to exactly `total`.
 */
export function allocate(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0) {
    // Nothing to weight by: divide evenly.
    return allocate(total, weights.map(() => 1));
  }

  const exact = weights.map((w) => (total * w) / sum);
  const floors = exact.map(Math.floor);
  let remainder = total - floors.reduce((s, v) => s + v, 0);

  // Hand the leftover cents to the largest fractional parts; ties go to the first.
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);

  for (const { index } of order) {
    if (remainder <= 0) break;
    floors[index]! += 1;
    remainder -= 1;
  }
  return floors;
}

export function splitBill(input: SplitInput): PersonShare[] {
  const { people } = input;
  if (people.length === 0) return [];

  const index = new Map(people.map((p, i) => [p.id, i]));
  const itemsCents = new Array<number>(people.length).fill(0);
  const itemsFor: { name: string; cents: number }[][] = people.map(() => []);

  for (const item of input.items) {
    const assigned = (input.assignments[item.id] ?? []).filter((id) => index.has(id));
    const sharers = assigned.length > 0 ? assigned : people.map((p) => p.id);
    const parts = allocate(item.cents, sharers.map(() => 1));
    sharers.forEach((id, i) => {
      const at = index.get(id)!;
      itemsCents[at]! += parts[i]!;
      itemsFor[at]!.push({
        name: sharers.length > 1 ? `${item.name} (shared by ${sharers.length})` : item.name,
        cents: parts[i]!,
      });
    });
  }

  const weights = input.extrasMode === 'even' ? people.map(() => 1) : itemsCents;
  const tax = allocate(input.taxCents, weights);
  const tip = allocate(input.tipCents, weights);

  return people.map((person, i) => ({
    personId: person.id,
    name: person.name,
    itemsCents: itemsCents[i]!,
    taxCents: tax[i]!,
    tipCents: tip[i]!,
    totalCents: itemsCents[i]! + tax[i]! + tip[i]!,
    items: itemsFor[i]!,
  }));
}

/** An even split of a card purchase: the simplest case, still exact to the cent. */
export function splitEvenly(totalCents: number, people: SplitPerson[]): PersonShare[] {
  const parts = allocate(totalCents, people.map(() => 1));
  return people.map((person, i) => ({
    personId: person.id,
    name: person.name,
    itemsCents: parts[i]!,
    taxCents: 0,
    tipCents: 0,
    totalCents: parts[i]!,
    items: [],
  }));
}
