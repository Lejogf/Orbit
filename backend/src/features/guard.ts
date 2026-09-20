// Subscription Guard.
//
// Decides what happens when a merchant tries to charge. The rules are pure so
// they can be tested directly; persisting the outcome is the caller's job.

export type GuardDecision = 'allow' | 'decline_pending_approval' | 'decline_blocked';

export interface GuardState {
  /** The subscription's status: active | guarded | blocked | canceled. */
  status: string;
  /** Set when the user approved a charge; lets the next attempt through. */
  oneTimeApprovalUntil: Date | null;
  /** active | locked | deleted, when a virtual card stands in for the real one. */
  virtualCardStatus: string | null;
  /**
   * Whether the underlying card is locked.
   *
   * Deliberately does NOT block the charge. A card lock stops new purchases,
   * cash advances and balance transfers, but recurring charges the cardholder
   * already authorised still go through — that is how Capital One's lock works,
   * and how most issuers implement it. Subscription Guard exists precisely
   * because locking the card does not stop subscriptions.
   */
  cardLocked?: boolean;
}

export interface GuardResult {
  decision: GuardDecision;
  /** True when the charge goes through. */
  allowed: boolean;
  /** Shown to the user in the alert. */
  reason: string;
  /** Whether a one-time approval was consumed by this attempt. */
  consumedApproval: boolean;
}

/**
 * Evaluates one charge attempt.
 *
 * Order matters. A deleted virtual card is checked first because deleting it is
 * how the user cancels a subscription outright — it must win over any lingering
 * approval. A one-time approval is then consumed by the very next attempt, so
 * approving a charge never quietly re-opens the merchant for good.
 */
export function evaluateCharge(state: GuardState, now: Date = new Date()): GuardResult {
  if (state.virtualCardStatus === 'deleted') {
    return {
      decision: 'decline_blocked',
      allowed: false,
      reason: 'The virtual card for this merchant was deleted.',
      consumedApproval: false,
    };
  }

  if (state.virtualCardStatus === 'locked') {
    return {
      decision: 'decline_blocked',
      allowed: false,
      reason: 'The virtual card for this merchant is locked.',
      consumedApproval: false,
    };
  }

  if (state.status === 'blocked' || state.status === 'canceled') {
    return {
      decision: 'decline_blocked',
      allowed: false,
      reason: 'This merchant is blocked from charging your card.',
      consumedApproval: false,
    };
  }

  if (state.status === 'guarded') {
    const approvalValid =
      state.oneTimeApprovalUntil !== null && state.oneTimeApprovalUntil.getTime() > now.getTime();

    if (approvalValid) {
      return {
        decision: 'allow',
        allowed: true,
        reason: 'You approved this charge.',
        consumedApproval: true,
      };
    }

    return {
      decision: 'decline_pending_approval',
      allowed: false,
      reason: 'Subscription Guard is on for this merchant. Approve the charge to let it through.',
      consumedApproval: false,
    };
  }

  return {
    decision: 'allow',
    allowed: true,
    reason: state.cardLocked
      ? 'Charge approved. A locked card still allows recurring charges you previously authorised — turn on Subscription Guard to stop them.'
      : 'Charge approved.',
    consumedApproval: false,
  };
}

/** How long an approval stays usable before it lapses. */
export const APPROVAL_WINDOW_HOURS = 24;

export function approvalExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + APPROVAL_WINDOW_HOURS * 3_600_000);
}

/**
 * A mock card number for the virtual-card feature. Not a real PAN.
 *
 * `seed` must include something that changes per generation (a timestamp), or
 * regenerating a card for the same subscription returns the same number — which
 * defeats the point of regenerating it.
 */
export function generateVirtualCard(seed: string): {
  number: string;
  last4: string;
  expMonth: number;
  expYear: number;
  cvv: string;
} {
  // Deterministic from the seed so re-rendering never changes the displayed card.
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }

  const digits = (count: number, offset: number): string => {
    let out = '';
    let value = (hash + offset) >>> 0;
    for (let i = 0; i < count; i++) {
      value = (value * 1103515245 + 12345) >>> 0;
      out += String(value % 10);
    }
    return out;
  };

  // 4747 prefix keeps it visibly fake rather than resembling a live BIN range.
  const number = `4747${digits(4, 1)}${digits(4, 2)}${digits(4, 3)}`;
  const now = new Date();

  return {
    number,
    last4: number.slice(-4),
    expMonth: (hash % 12) + 1,
    expYear: now.getUTCFullYear() + 3,
    cvv: digits(3, 7),
  };
}
