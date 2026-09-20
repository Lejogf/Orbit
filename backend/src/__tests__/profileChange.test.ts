import { describe, expect, test } from 'vitest';
import {
  MAX_CODE_ATTEMPTS,
  checkAddress,
  checkDocument,
  checkLegalName,
  generateCode,
  hashCode,
  maskPhone,
  standardizeLine,
  verifyCode,
} from '../features/profileChange.js';

describe('checkAddress', () => {
  test('standardises a valid address and says it changed', () => {
    const result = checkAddress({ line1: '42  oak street apartment 5', city: 'richmond', state: 'va', postalCode: '23220' });
    expect(result.ok).toBe(true);
    expect(result.standardized).toEqual({ line1: '42 Oak St Apt 5', line2: null, city: 'Richmond', state: 'VA', postalCode: '23220' });
    expect(result.changed).toBe(true);
  });

  test('rejects PO boxes as a home address', () => {
    const result = checkAddress({ line1: 'PO Box 123', city: 'Richmond', state: 'VA', postalCode: '23220' });
    expect(result.errors.map((e) => e.field)).toContain('line1');
  });

  test('reports every bad field at once', () => {
    const result = checkAddress({ line1: 'Oak', city: '1', state: 'ZZ', postalCode: '123' });
    expect(result.errors.map((e) => e.field).sort()).toEqual(['city', 'line1', 'postalCode', 'state']);
  });

  test('accepts ZIP+4', () => {
    expect(checkAddress({ line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701-1234' }).ok).toBe(true);
  });
});

describe('standardizeLine', () => {
  test('abbreviates suffixes and directions', () => {
    expect(standardizeLine('100 north capitol boulevard')).toBe('100 N Capitol Blvd');
  });
});

describe('checkLegalName', () => {
  test('accepts real-world names: hyphens, apostrophes, accents', () => {
    for (const [first, last] of [['Zoë', "O'Brien-Nguyen"], ['José', 'García Márquez'], ['Mary Ann', 'St. James']]) {
      expect(checkLegalName(first!, last!).ok).toBe(true);
    }
  });

  test('rejects digits and empty names', () => {
    expect(checkLegalName('J0rdan', '').errors.map((e) => e.field)).toEqual(['firstName', 'lastName']);
  });
});

describe('checkDocument', () => {
  test('accepts photos and PDFs within the size limit', () => {
    expect(checkDocument({ type: 'image/jpeg', size: 200_000, name: 'cert.jpg' })).toBeNull();
    expect(checkDocument({ type: 'application/pdf', size: 1_000, name: 'decree.pdf' })).toBeNull();
  });

  test('rejects other types and oversize files', () => {
    expect(checkDocument({ type: 'text/plain', size: 10, name: 'a.txt' })).toMatch(/photo/);
    expect(checkDocument({ type: 'image/png', size: 11 * 1024 * 1024, name: 'big.png' })).toMatch(/10 MB/);
  });
});

describe('one-time codes', () => {
  const now = new Date('2026-09-19T12:00:00Z');
  const salt = 'salt';
  const code = '123456';
  const stored = { hash: hashCode(code, salt), salt, expiresAt: new Date(now.getTime() + 60_000), attempts: 0 };

  test('codes are six digits', () => {
    for (let i = 0; i < 20; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });

  test('verifies, ignoring spaces the customer types', () => {
    expect(verifyCode('123 456', stored, now)).toBe('ok');
    expect(verifyCode('000000', stored, now)).toBe('wrong');
  });

  test('expires and locks', () => {
    expect(verifyCode(code, stored, new Date(now.getTime() + 120_000))).toBe('expired');
    expect(verifyCode(code, { ...stored, attempts: MAX_CODE_ATTEMPTS }, now)).toBe('locked');
  });
});

describe('maskPhone', () => {
  test('shows only the last two digits', () => {
    expect(maskPhone('(804) 555-0142')).toBe('••42');
    expect(maskPhone(null)).toBeNull();
  });
});
