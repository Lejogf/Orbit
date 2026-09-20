// Registration, sign-in, sessions and account closure.
//
// Passwords are hashed with scrypt and a per-user salt. Sessions are opaque
// random tokens stored server-side and handed to the browser in an httpOnly
// cookie, so JavaScript on the page can never read them.

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { PrismaClient } from '@prisma/client';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;

/** How long a session stays valid. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE = 'flow_session';

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return { hash: derived.toString('hex'), salt };
}

/**
 * Compares in constant time. A plain `===` leaks how much of the hash matched
 * through timing, which is enough to reconstruct it given enough attempts.
 */
export async function verifyPassword(
  password: string,
  hash: string,
  salt: string,
): Promise<boolean> {
  const derived = await scrypt(password, salt, KEY_LENGTH);
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

export interface Credentials {
  email: string;
  password: string;
}

export interface RegistrationDetails extends Credentials {
  firstName: string;
  lastName: string;
  phone?: string;
  dateOfBirth?: string;
}

/** Normalised so "A@B.com " and "a@b.com" are the same account. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface AuthFailure {
  error: string;
  /** Field the message belongs against, when it maps to one. */
  field?: 'email' | 'password' | 'firstName' | 'lastName' | 'dateOfBirth';
}

/** Minimum bar for a password. Length does more work than character classes. */
export function checkPasswordStrength(password: string): AuthFailure | null {
  if (password.length < 10) {
    return { error: 'Use at least 10 characters.', field: 'password' };
  }
  if (/^\d+$/.test(password)) {
    return { error: 'Digits alone are too easy to guess. Add letters.', field: 'password' };
  }
  // Reject passwords that are essentially just a common word. A plain
  // `includes` is too blunt — it would turn down "my-passwords-vault-99", which
  // is a perfectly good passphrase. Instead, strip the common word and see
  // whether anything substantial is left.
  const COMMON = ['password', 'qwerty', '123456', 'letmein', 'capitalone', 'iloveyou', 'admin'];
  const normalised = password.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const weak of COMMON) {
    if (!normalised.includes(weak)) continue;
    const remainder = normalised.split(weak).join('');
    if (remainder.length < 6) {
      return {
        error: 'That password is too close to a common one. Choose something less predictable.',
        field: 'password',
      };
    }
  }

  return null;
}

/** Must be a real date, in the past, and old enough to hold an account. */
export function checkDateOfBirth(value: string): AuthFailure | null {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return { error: 'Enter a valid date.', field: 'dateOfBirth' };
  }

  const now = new Date();
  if (date > now) return { error: 'Date of birth cannot be in the future.', field: 'dateOfBirth' };

  const age = (now.getTime() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (age < 18) {
    return { error: 'You must be 18 or over to open an account.', field: 'dateOfBirth' };
  }
  if (age > 120) return { error: 'Enter a valid date of birth.', field: 'dateOfBirth' };

  return null;
}

export async function createSession(prisma: PrismaClient, customerId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await prisma.session.create({
    data: { customerId, token, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
  return token;
}

/** Returns the signed-in customer, or null when the token is absent or stale. */
export async function customerForToken(prisma: PrismaClient, token: string | undefined) {
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    include: { customer: true },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt < new Date()) return null;
  // A closed account cannot be used, even with a session that predates closure.
  if (session.customer.closedAt) return null;

  return session.customer;
}

export async function revokeSession(prisma: PrismaClient, token: string | undefined): Promise<void> {
  if (!token) return;
  await prisma.session.updateMany({
    where: { token, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Signs out everywhere. Offered in settings after a password change. */
export async function revokeAllSessions(prisma: PrismaClient, customerId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { customerId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/** Reasons an account cannot be closed yet. Empty means it can. */
export async function closureBlockers(
  prisma: PrismaClient,
  customerId: string,
): Promise<string[]> {
  const blockers: string[] = [];

  const accounts = await prisma.account.findMany({ where: { customerId } });

  const owing = accounts.filter((a) => a.type === 'Credit Card' && a.balanceCents > 0);
  if (owing.length > 0) {
    blockers.push(
      `Pay off your card balance first. You owe $${(owing.reduce((sum, a) => sum + a.balanceCents, 0) / 100).toFixed(2)}.`,
    );
  }

  const positive = accounts.filter((a) => a.type !== 'Credit Card' && a.balanceCents > 0);
  if (positive.length > 0) {
    blockers.push(
      `Move your remaining $${(positive.reduce((sum, a) => sum + a.balanceCents, 0) / 100).toFixed(2)} out first. We can't close an account holding money.`,
    );
  }

  const activePlans = await prisma.installmentPlan.count({
    where: { accountId: { in: accounts.map((a) => a.id) }, status: 'active' },
  });
  if (activePlans > 0) {
    blockers.push(
      `You have ${activePlans} active Pay Over Time ${activePlans === 1 ? 'plan' : 'plans'}. Pay them off before closing.`,
    );
  }

  const liveSubscriptions = await prisma.subscription.count({
    where: {
      accountId: { in: accounts.map((a) => a.id) },
      status: { in: ['active', 'guarded'] },
    },
  });
  if (liveSubscriptions > 0) {
    blockers.push(
      `${liveSubscriptions} ${liveSubscriptions === 1 ? 'subscription is' : 'subscriptions are'} still billing this card. Block or cancel them so they don't fail after closure.`,
    );
  }

  return blockers;
}

/**
 * Closes an account. The record is retained rather than deleted, because
 * financial history has to outlive the relationship.
 */
export async function closeAccount(prisma: PrismaClient, customerId: string): Promise<void> {
  await prisma.customer.update({
    where: { id: customerId },
    data: { closedAt: new Date() },
  });
  await revokeAllSessions(prisma, customerId);
}
