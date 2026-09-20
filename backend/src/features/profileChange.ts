// Rules for changing identity details.
//
// Life changes — people marry, divorce, transition, move — and a bank app that
// simply refuses is failing them. But a bank also can't accept a new legal name
// on trust: customer identification rules require the change to be evidenced.
// So the app lets people start the change themselves and tells them exactly what
// happens next, instead of sending them to a branch.
//
//   Address     verified by a one-time code to the phone already on file, then
//               effective immediately (and mirrored to Nessie).
//   Legal name  needs a supporting document and a review, typically one
//               business day, with the status visible in-app throughout.

import { createHash, randomInt } from 'node:crypto';

export const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS',
  'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC',
  'ND', 'OH', 'OK', 'OR', 'PA', 'PR', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
]);

const STREET_SUFFIXES: [RegExp, string][] = [
  [/\bstreet\b/gi, 'St'],
  [/\bavenue\b/gi, 'Ave'],
  [/\bboulevard\b/gi, 'Blvd'],
  [/\bdrive\b/gi, 'Dr'],
  [/\broad\b/gi, 'Rd'],
  [/\blane\b/gi, 'Ln'],
  [/\bcourt\b/gi, 'Ct'],
  [/\bplace\b/gi, 'Pl'],
  [/\bparkway\b/gi, 'Pkwy'],
  [/\bapartment\b/gi, 'Apt'],
  [/\bsuite\b/gi, 'Ste'],
  [/\bnorth\b/gi, 'N'],
  [/\bsouth\b/gi, 'S'],
  [/\beast\b/gi, 'E'],
  [/\bwest\b/gi, 'W'],
];

export interface AddressInput {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
}

export interface AddressCheck {
  ok: boolean;
  errors: { field: keyof AddressInput; message: string }[];
  /** The standardised form, shown to the customer before they confirm. */
  standardized: AddressInput | null;
  /** True when standardising changed what they typed. */
  changed: boolean;
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\b(Po)\b/g, 'PO');
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function standardizeLine(line: string): string {
  let result = titleCase(collapse(line)).replace(/[.,]+$/g, '');
  for (const [pattern, abbreviation] of STREET_SUFFIXES) result = result.replace(pattern, abbreviation);
  // "Apt5" / "#5" -> "Apt 5"
  return result.replace(/\bApt\s*#?\s*/i, 'Apt ').replace(/^#\s*/, 'Apt ').replace(/\s+,/g, ',');
}

export function checkAddress(input: AddressInput): AddressCheck {
  const errors: AddressCheck['errors'] = [];
  const line1 = collapse(input.line1 ?? '');
  const city = collapse(input.city ?? '');
  const state = collapse(input.state ?? '').toUpperCase();
  const postal = collapse(input.postalCode ?? '');

  if (line1.length < 4 || !/\d/.test(line1)) {
    errors.push({ field: 'line1', message: 'Enter a street address with a house or building number.' });
  }
  if (/\bp\.?\s?o\.?\s*box\b/i.test(line1)) {
    errors.push({ field: 'line1', message: 'Your home address can’t be a PO Box. You can add a PO Box as a mailing address with a specialist.' });
  }
  if (city.length < 2 || /\d/.test(city)) errors.push({ field: 'city', message: 'Enter a city.' });
  if (!US_STATES.has(state)) errors.push({ field: 'state', message: 'Choose a US state.' });
  if (!/^\d{5}(-\d{4})?$/.test(postal)) errors.push({ field: 'postalCode', message: 'Enter a 5-digit ZIP code.' });

  if (errors.length > 0) return { ok: false, errors, standardized: null, changed: false };

  const standardized: AddressInput = {
    line1: standardizeLine(line1),
    line2: input.line2 ? standardizeLine(input.line2) : null,
    city: titleCase(city),
    state,
    postalCode: postal,
  };

  const changed =
    standardized.line1 !== line1 ||
    (standardized.line2 ?? '') !== collapse(input.line2 ?? '') ||
    standardized.city !== city;

  return { ok: true, errors: [], standardized, changed };
}

// --- legal name ---

export const NAME_CHANGE_REASONS = [
  { id: 'marriage', label: 'Marriage', documents: ['Marriage certificate'] },
  { id: 'divorce', label: 'Divorce', documents: ['Divorce decree'] },
  { id: 'court_order', label: 'Court order', documents: ['Court order'] },
  { id: 'gender_affirmation', label: 'Gender affirmation', documents: ['Court order', 'Updated driver’s license or state ID', 'Updated passport'] },
  { id: 'correction', label: 'Correct a mistake', documents: ['Driver’s license or state ID', 'Passport'] },
  { id: 'other', label: 'Other', documents: ['Court order', 'Updated driver’s license or state ID', 'Updated passport'] },
] as const;

export type NameChangeReason = (typeof NAME_CHANGE_REASONS)[number]['id'];

const NAME_PATTERN = /^[\p{L}][\p{L}\p{M}'’ .-]*$/u;

export function checkLegalName(first: string, last: string, middle?: string | null) {
  const errors: { field: 'firstName' | 'lastName' | 'middleName'; message: string }[] = [];
  const clean = (v: string) => collapse(v ?? '');
  const f = clean(first);
  const l = clean(last);
  const m = middle ? clean(middle) : '';

  // Names are not validated against a Western model: hyphens, apostrophes,
  // accents and single-word surnames are all real.
  if (!f || f.length > 60 || !NAME_PATTERN.test(f)) errors.push({ field: 'firstName', message: 'Enter your first name as it appears on your document.' });
  if (!l || l.length > 80 || !NAME_PATTERN.test(l)) errors.push({ field: 'lastName', message: 'Enter your last name as it appears on your document.' });
  if (m && (m.length > 60 || !NAME_PATTERN.test(m))) errors.push({ field: 'middleName', message: 'Check your middle name.' });

  return { ok: errors.length === 0, errors, value: { firstName: f, lastName: l, middleName: m || null } };
}

export const ACCEPTED_DOCUMENT_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'application/pdf'];
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export function checkDocument(doc: { type: string; size: number; name: string }): string | null {
  if (!ACCEPTED_DOCUMENT_TYPES.includes(doc.type)) return 'Upload a photo (JPG, PNG, HEIC) or a PDF.';
  if (doc.size <= 0) return 'That file looks empty. Try another photo.';
  if (doc.size > MAX_DOCUMENT_BYTES) return 'That file is over 10 MB. Try a smaller photo.';
  if (doc.name.length > 200) return 'That file name is too long.';
  return null;
}

// --- one-time codes ---

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashCode(code: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

export type CodeCheck = 'ok' | 'wrong' | 'expired' | 'locked';

export function verifyCode(
  attempt: string,
  stored: { hash: string; salt: string; expiresAt: Date; attempts: number },
  now: Date,
): CodeCheck {
  if (stored.attempts >= MAX_CODE_ATTEMPTS) return 'locked';
  if (now > stored.expiresAt) return 'expired';
  return hashCode(attempt.replace(/\D/g, ''), stored.salt) === stored.hash ? 'ok' : 'wrong';
}

/** "(804) 555-0142" -> "••42", so the screen can say where the code went. */
export function maskPhone(phone: string | null): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? `••${digits.slice(-2)}` : null;
}
