import { describe, expect, test } from 'vitest';
import { allocate, parsePrice, parseReceiptText, splitBill, splitEvenly } from '../features/receipt.js';

const RECEIPT = `
THE COPPER POT
1680 Main St, Richmond VA
Table 12   Server: Dana
2 Margherita Pizza      31.98
Caesar Salad            12.50
Truffle Fries            9.00
3 x Lemonade            13.50
SUBTOTAL                66.98
Sales Tax                5.86
Tip                     12.00
TOTAL                   84.84
VISA ****1234           84.84
`;

describe('parsePrice', () => {
  test('handles symbols, thousands separators and decimal commas', () => {
    expect(parsePrice('$12.99')).toBe(1299);
    expect(parsePrice('1,299.00')).toBe(129_900);
    expect(parsePrice('12,99')).toBe(1299);
  });
});

describe('parseReceiptText', () => {
  const parsed = parseReceiptText(RECEIPT);

  test('reads the merchant from the header', () => {
    expect(parsed.merchant).toBe('THE COPPER POT');
  });

  test('extracts items with quantities, skipping summary and payment lines', () => {
    expect(parsed.items.map((i) => [i.name, i.cents, i.quantity])).toEqual([
      ['Margherita Pizza', 3198, 2],
      ['Caesar Salad', 1250, 1],
      ['Truffle Fries', 900, 1],
      ['Lemonade', 1350, 3],
    ]);
  });

  test('reads subtotal, tax, tip and total, and reconciles', () => {
    expect(parsed).toEqual(expect.objectContaining({ subtotalCents: 6698, taxCents: 586, tipCents: 1200, totalCents: 8484 }));
    expect(parsed.reconciles).toBe(true);
  });

  test('flags a receipt whose items do not add up', () => {
    expect(parseReceiptText('Burger 10.00\nSubtotal 25.00').reconciles).toBe(false);
  });

  test('survives empty input', () => {
    expect(parseReceiptText('').items).toEqual([]);
  });
});

describe('allocate', () => {
  test('always sums to the total exactly', () => {
    for (const [total, weights] of [[100, [1, 1, 1]], [586, [3198, 1250, 900]], [1, [1, 1]], [999, [0, 0, 0]]] as const) {
      const parts = allocate(total, [...weights]);
      expect(parts.reduce((s, v) => s + v, 0)).toBe(total);
    }
  });

  test('gives the leftover cent to the largest remainder', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });
});

describe('splitBill', () => {
  const parsed = parseReceiptText(RECEIPT);
  const people = [
    { id: 'me', name: 'You' },
    { id: 'sam', name: 'Sam' },
    { id: 'alex', name: 'Alex' },
  ];

  test('assigned items go to their owners; unassigned are shared by all', () => {
    const shares = splitBill({
      items: parsed.items,
      people,
      assignments: { 'item-1': ['me', 'sam'], 'item-2': ['alex'] },
      taxCents: 586,
      tipCents: 1200,
    });
    const total = shares.reduce((s, p) => s + p.totalCents, 0);
    expect(total).toBe(8484);
    const alex = shares.find((s) => s.personId === 'alex')!;
    // Caesar 12.50 + a third of fries and lemonade (3.00 + 4.50).
    expect(alex.itemsCents).toBe(1250 + 300 + 450);
  });

  test('tax and tip follow each share of the food', () => {
    const shares = splitBill({
      items: [{ id: 'a', name: 'Steak', cents: 3000, quantity: 1 }, { id: 'b', name: 'Soup', cents: 1000, quantity: 1 }],
      people: people.slice(0, 2),
      assignments: { a: ['me'], b: ['sam'] },
      taxCents: 400,
      tipCents: 800,
    });
    expect(shares[0]).toEqual(expect.objectContaining({ taxCents: 300, tipCents: 600, totalCents: 3900 }));
    expect(shares[1]).toEqual(expect.objectContaining({ taxCents: 100, tipCents: 200, totalCents: 1300 }));
  });

  test('can divide extras evenly instead', () => {
    const shares = splitBill({
      items: [{ id: 'a', name: 'Steak', cents: 3000, quantity: 1 }],
      people: people.slice(0, 2),
      assignments: { a: ['me'] },
      taxCents: 400,
      tipCents: 0,
      extrasMode: 'even',
    });
    expect(shares.map((s) => s.taxCents)).toEqual([200, 200]);
  });

  test('ignores assignments to people who were removed', () => {
    const shares = splitBill({
      items: [{ id: 'a', name: 'Wine', cents: 1000, quantity: 1 }],
      people: people.slice(0, 2),
      assignments: { a: ['ghost'] },
      taxCents: 0,
      tipCents: 0,
    });
    expect(shares.map((s) => s.totalCents)).toEqual([500, 500]);
  });
});

describe('splitEvenly', () => {
  test('splits a card purchase to the cent', () => {
    const shares = splitEvenly(10_000, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]);
    expect(shares.map((s) => s.totalCents)).toEqual([3334, 3333, 3333]);
  });
});
