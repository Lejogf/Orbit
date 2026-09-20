import { describe, expect, test } from 'vitest';
import {
  approvalExpiry,
  evaluateCharge,
  generateVirtualCard,
  type GuardState,
} from '../features/guard.js';

const NOW = new Date(Date.UTC(2026, 8, 19, 12));

const state = (overrides: Partial<GuardState> = {}): GuardState => ({
  status: 'active',
  oneTimeApprovalUntil: null,
  virtualCardStatus: null,
  ...overrides,
});

describe('evaluateCharge', () => {
  test('allows a charge on an ordinary active subscription', () => {
    const result = evaluateCharge(state(), NOW);
    expect(result.allowed).toBe(true);
    expect(result.decision).toBe('allow');
  });

  test('declines and asks when Guard is on', () => {
    const result = evaluateCharge(state({ status: 'guarded' }), NOW);
    expect(result.allowed).toBe(false);
    expect(result.decision).toBe('decline_pending_approval');
    expect(result.reason).toMatch(/Approve the charge/);
  });

  test('declines outright when the merchant is blocked', () => {
    const result = evaluateCharge(state({ status: 'blocked' }), NOW);
    expect(result.decision).toBe('decline_blocked');
    expect(result.allowed).toBe(false);
  });

  test('declines a cancelled subscription', () => {
    expect(evaluateCharge(state({ status: 'canceled' }), NOW).allowed).toBe(false);
  });
});

describe('one-time approval', () => {
  test('lets a single charge through while the approval is valid', () => {
    const result = evaluateCharge(
      state({ status: 'guarded', oneTimeApprovalUntil: new Date(NOW.getTime() + 3_600_000) }),
      NOW,
    );

    expect(result.allowed).toBe(true);
    expect(result.consumedApproval).toBe(true);
  });

  test('an expired approval does not let a charge through', () => {
    const result = evaluateCharge(
      state({ status: 'guarded', oneTimeApprovalUntil: new Date(NOW.getTime() - 1000) }),
      NOW,
    );

    expect(result.allowed).toBe(false);
    expect(result.decision).toBe('decline_pending_approval');
  });

  test('approving does not unblock a permanently blocked merchant', () => {
    const result = evaluateCharge(
      state({ status: 'blocked', oneTimeApprovalUntil: new Date(NOW.getTime() + 3_600_000) }),
      NOW,
    );
    expect(result.allowed).toBe(false);
  });

  test('the approval window is 24 hours', () => {
    expect(approvalExpiry(NOW).getTime() - NOW.getTime()).toBe(24 * 3_600_000);
  });
});

describe('virtual cards', () => {
  test('a deleted card declines the charge, which is how cancelling works', () => {
    const result = evaluateCharge(state({ virtualCardStatus: 'deleted' }), NOW);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/deleted/);
  });

  test('a locked card declines the charge', () => {
    expect(evaluateCharge(state({ virtualCardStatus: 'locked' }), NOW).allowed).toBe(false);
  });

  test('an active card does not interfere', () => {
    expect(evaluateCharge(state({ virtualCardStatus: 'active' }), NOW).allowed).toBe(true);
  });

  test('a deleted card beats a live approval', () => {
    const result = evaluateCharge(
      state({
        status: 'guarded',
        virtualCardStatus: 'deleted',
        oneTimeApprovalUntil: new Date(NOW.getTime() + 3_600_000),
      }),
      NOW,
    );
    expect(result.allowed).toBe(false);
  });
});

describe('generateVirtualCard', () => {
  test('is deterministic for the same seed', () => {
    expect(generateVirtualCard('sub-1')).toEqual(generateVirtualCard('sub-1'));
  });

  test('differs between merchants', () => {
    expect(generateVirtualCard('sub-1').number).not.toBe(generateVirtualCard('sub-2').number);
  });

  test('produces a well-formed, obviously fake number', () => {
    const card = generateVirtualCard('sub-netflix');
    expect(card.number).toHaveLength(16);
    expect(card.number).toMatch(/^4747\d{12}$/);
    expect(card.last4).toBe(card.number.slice(-4));
    expect(card.cvv).toMatch(/^\d{3}$/);
    expect(card.expMonth).toBeGreaterThanOrEqual(1);
    expect(card.expMonth).toBeLessThanOrEqual(12);
    expect(card.expYear).toBeGreaterThan(new Date().getUTCFullYear());
  });
});
