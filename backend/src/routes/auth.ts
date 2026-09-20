// Registration, sign-in, sign-out, profile and account closure.
import { Router } from 'express';
import { z } from 'zod';
import type { Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { ApiError, asyncRoute, sendOk } from '../lib/http.js';
import { config } from '../config.js';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  checkDateOfBirth,
  checkPasswordStrength,
  closeAccount,
  closureBlockers,
  createSession,
  checkUsername,
  hashPassword,
  identifierKind,
  normaliseEmail,
  normaliseUsername,
  revokeAllSessions,
  revokeSession,
  verifyPassword,
} from '../services/auth.js';
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_USERNAME, syncSnapshot } from '../data/sync.js';
import { createMockProvider } from '../data/provider.js';
import { refreshSubscriptions } from '../services/subscriptions.js';
import { requireCustomer } from '../middleware/session.js';

export const authRouter = Router();

function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, // JavaScript on the page must never read the session
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

/** Shape the client needs; never includes the hash or salt. */
function publicProfile(customer: {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  username: string | null;
  trustedContactName: string | null;
  trustedContactPhone: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  dateOfBirth: Date | null;
  ssnLast4: string | null;
  creditScore: number;
  isDemoUser: boolean;
  createdAt: Date;
}) {
  return {
    id: customer.id,
    firstName: customer.firstName,
    lastName: customer.lastName,
    initials: `${customer.firstName[0] ?? ''}${customer.lastName[0] ?? ''}`,
    email: customer.email,
    username: customer.username,
    trustedContact: customer.trustedContactName
      ? { name: customer.trustedContactName, phone: customer.trustedContactPhone }
      : null,
    phone: customer.phone,
    address: {
      line1: customer.addressLine1,
      line2: customer.addressLine2,
      city: customer.city,
      state: customer.state,
      postalCode: customer.postalCode,
    },
    dateOfBirth: customer.dateOfBirth?.toISOString().slice(0, 10) ?? null,
    ssnLast4: customer.ssnLast4,
    creditScore: customer.creditScore,
    isDemoUser: customer.isDemoUser,
    memberSince: customer.createdAt.toISOString(),
  };
}

// --- registration ---

const registerSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name.').max(60),
  lastName: z.string().trim().min(1, 'Enter your last name.').max(60),
  email: z.string().trim().email('Enter a valid email address.').max(200),
  username: z.string().max(40).optional(),
  password: z.string().min(1, 'Choose a password.').max(200),
  phone: z.string().trim().max(30).optional(),
  dateOfBirth: z.string().optional(),
});

authRouter.post(
  '/auth/register',
  asyncRoute(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const email = normaliseEmail(body.email);

    const weak = checkPasswordStrength(body.password);
    if (weak) throw new ApiError(400, 'WEAK_PASSWORD', weak.error, { field: weak.field });

    if (body.dateOfBirth) {
      const badDate = checkDateOfBirth(body.dateOfBirth);
      if (badDate) throw new ApiError(400, 'INVALID_DOB', badDate.error, { field: badDate.field });
    }

    const taken = await prisma.customer.findUnique({ where: { email } });
    if (taken) {
      throw new ApiError(
        409,
        'EMAIL_TAKEN',
        'An account already exists with that email. Try signing in instead.',
        { field: 'email' },
      );
    }

    const username = body.username?.trim() ? normaliseUsername(body.username) : null;
    if (username) {
      const problem = checkUsername(username);
      if (problem) throw new ApiError(400, 'INVALID_USERNAME', problem, { field: 'username' });
      if (await prisma.customer.findUnique({ where: { username } })) {
        throw new ApiError(409, 'USERNAME_TAKEN', 'That username is taken. Try another.', { field: 'username' });
      }
    }

    const { hash, salt } = await hashPassword(body.password);

    const customer = await prisma.customer.create({
      data: {
        firstName: body.firstName,
        lastName: body.lastName,
        email,
        username,
        passwordHash: hash,
        passwordSalt: salt,
        phone: body.phone || null,
        dateOfBirth: body.dateOfBirth ? new Date(`${body.dateOfBirth}T00:00:00.000Z`) : null,
        preferences: { create: {} },
      },
    });

    setSessionCookie(res, await createSession(prisma, customer.id));

    sendOk(
      res,
      {
        customer: publicProfile(customer),
        // A brand new customer has no accounts or history yet, and the UI needs
        // to say so rather than showing a broken-looking empty dashboard.
        hasBankingData: false,
      },
      201,
    );
  }),
);

// --- sign in ---

authRouter.post(
  '/auth/login',
  asyncRoute(async (req, res) => {
    // `identifier` is a username or an email; `email` is still accepted from
    // older clients.
    const body = z
      .object({
        identifier: z.string().trim().max(200).optional(),
        email: z.string().trim().max(200).optional(),
        password: z.string().min(1, 'Enter your password.'),
      })
      .parse(req.body);

    const identifier = (body.identifier ?? body.email ?? '').trim();
    if (!identifier) {
      throw new ApiError(400, 'MISSING_IDENTIFIER', 'Enter your username or email.', { field: 'identifier' });
    }

    const customer =
      identifierKind(identifier) === 'email'
        ? await prisma.customer.findUnique({ where: { email: normaliseEmail(identifier) } })
        : await prisma.customer.findUnique({ where: { username: normaliseUsername(identifier) } });

    // Same message whether the account is unknown or the password is wrong, so
    // the response can't be used to discover which accounts exist.
    const invalid = new ApiError(
      401,
      'INVALID_CREDENTIALS',
      "That username or email and password don't match an account.",
    );

    if (!customer) {
      // Still hash, so a missing account isn't detectably faster than a wrong password.
      await hashPassword(body.password);
      throw invalid;
    }

    const ok = await verifyPassword(body.password, customer.passwordHash, customer.passwordSalt);
    if (!ok) throw invalid;

    if (customer.closedAt) {
      throw new ApiError(
        403,
        'ACCOUNT_CLOSED',
        'This account has been closed. Contact us if you need to reopen it.',
      );
    }

    setSessionCookie(res, await createSession(prisma, customer.id));
    const accounts = await prisma.account.count({ where: { customerId: customer.id } });

    sendOk(res, { customer: publicProfile(customer), hasBankingData: accounts > 0 });
  }),
);

/** One-tap sign-in for reviewers. Credentials are public on the sign-in screen. */
authRouter.post(
  '/auth/demo',
  asyncRoute(async (_req, res) => {
    const customer = await prisma.customer.findFirst({ where: { isDemoUser: true } });
    if (!customer) {
      throw new ApiError(
        503,
        'NOT_SEEDED',
        'The demo account has not been created yet. Run `npm run seed` from the project root.',
      );
    }

    setSessionCookie(res, await createSession(prisma, customer.id));
    sendOk(res, { customer: publicProfile(customer), hasBankingData: true });
  }),
);

authRouter.get(
  '/auth/demo-credentials',
  asyncRoute(async (_req, res) => {
    // Published deliberately: this build has no real customers.
    sendOk(res, { email: DEMO_EMAIL, username: DEMO_USERNAME, password: DEMO_PASSWORD });
  }),
);

authRouter.post(
  '/auth/logout',
  asyncRoute(async (req, res) => {
    await revokeSession(prisma, req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    sendOk(res, { signedOut: true });
  }),
);

// --- the signed-in customer ---

authRouter.get(
  '/auth/me',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const accounts = await prisma.account.count({ where: { customerId: customer.id } });
    const preferences = await prisma.preference.findUnique({ where: { customerId: customer.id } });

    sendOk(res, {
      customer: publicProfile(customer),
      hasBankingData: accounts > 0,
      preferences: preferences ?? null,
    });
  }),
);

// --- editable profile ---

const profileSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(200).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  addressLine1: z.string().trim().max(120).nullable().optional(),
  addressLine2: z.string().trim().max(120).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  state: z.string().trim().max(40).nullable().optional(),
  postalCode: z.string().trim().max(12).nullable().optional(),
});

authRouter.patch(
  '/auth/profile',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const body = profileSchema.parse(req.body);

    if (body.email) {
      const email = normaliseEmail(body.email);
      if (email !== customer.email) {
        const taken = await prisma.customer.findUnique({ where: { email } });
        if (taken) {
          throw new ApiError(409, 'EMAIL_TAKEN', 'That email is already in use.', {
            field: 'email',
          });
        }
      }
      body.email = email;
    }

    const updated = await prisma.customer.update({
      where: { id: customer.id },
      data: body,
    });

    sendOk(res, publicProfile(updated));
  }),
);

authRouter.post(
  '/auth/password',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const body = z
      .object({
        currentPassword: z.string().min(1, 'Enter your current password.'),
        newPassword: z.string().min(1, 'Choose a new password.'),
      })
      .parse(req.body);

    const ok = await verifyPassword(
      body.currentPassword,
      customer.passwordHash,
      customer.passwordSalt,
    );
    if (!ok) {
      throw new ApiError(401, 'WRONG_PASSWORD', 'Your current password is not correct.', {
        field: 'currentPassword',
      });
    }

    if (body.newPassword === body.currentPassword) {
      throw new ApiError(400, 'SAME_PASSWORD', 'Your new password must be different.', {
        field: 'newPassword',
      });
    }

    const weak = checkPasswordStrength(body.newPassword);
    if (weak) throw new ApiError(400, 'WEAK_PASSWORD', weak.error, { field: 'newPassword' });

    const { hash, salt } = await hashPassword(body.newPassword);
    await prisma.customer.update({
      where: { id: customer.id },
      data: { passwordHash: hash, passwordSalt: salt },
    });

    // Changing a password should end other sessions — that is the point of doing
    // it when you suspect someone else has access.
    await revokeAllSessions(prisma, customer.id);
    setSessionCookie(res, await createSession(prisma, customer.id));

    sendOk(res, { changed: true, otherSessionsSignedOut: true });
  }),
);

const preferencesSchema = z.object({
  alertsPush: z.boolean().optional(),
  alertsEmail: z.boolean().optional(),
  alertsSms: z.boolean().optional(),
  marketingEmail: z.boolean().optional(),
  paperless: z.boolean().optional(),
  alertEveryCharge: z.boolean().optional(),
  lowBalanceThresholdCents: z.number().int().min(0).max(1_000_000).nullable().optional(),
});

authRouter.patch(
  '/auth/preferences',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const body = preferencesSchema.parse(req.body);

    const preferences = await prisma.preference.upsert({
      where: { customerId: customer.id },
      update: body,
      create: { customerId: customer.id, ...body },
    });

    sendOk(res, preferences);
  }),
);

authRouter.post(
  '/auth/sign-out-everywhere',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const count = await revokeAllSessions(prisma, customer.id);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    sendOk(res, { signedOutSessions: count });
  }),
);

/**
 * Fills a brand-new account with sample banking data.
 *
 * Registering leaves you with no accounts and nothing to look at. Rather than
 * showing an app that appears broken, this gives the new customer their own copy
 * of the demo dataset — their own accounts and history, isolated from everyone
 * else's.
 */
authRouter.post(
  '/auth/load-sample-data',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);

    const existing = await prisma.account.count({ where: { customerId: customer.id } });
    if (existing > 0) {
      throw new ApiError(
        409,
        'ALREADY_HAS_DATA',
        'This account already has banking data. Sample data can only be loaded into an empty account.',
      );
    }

    const snapshot = await createMockProvider().fetchSnapshot();
    const result = await syncSnapshot(prisma, snapshot, customer.id);
    await refreshSubscriptions(prisma, customer.id);

    sendOk(res, { loaded: true, ...result });
  }),
);

// --- closing the account ---

authRouter.get(
  '/auth/closure-check',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const blockers = await closureBlockers(prisma, customer.id);
    sendOk(res, { canClose: blockers.length === 0, blockers });
  }),
);

authRouter.post(
  '/auth/close-account',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const body = z
      .object({
        password: z.string().min(1, 'Enter your password to confirm.'),
        // Typing the phrase makes closure a deliberate act, not a stray click.
        confirmation: z.string(),
      })
      .parse(req.body);

    if (customer.isDemoUser) {
      throw new ApiError(
        403,
        'DEMO_ACCOUNT',
        'The demo account cannot be closed — other people need it to try the app. Register your own account to test closure.',
      );
    }

    if (body.confirmation.trim().toUpperCase() !== 'CLOSE MY ACCOUNT') {
      throw new ApiError(
        400,
        'CONFIRMATION_MISMATCH',
        'Type "CLOSE MY ACCOUNT" exactly to confirm.',
        { field: 'confirmation' },
      );
    }

    const ok = await verifyPassword(body.password, customer.passwordHash, customer.passwordSalt);
    if (!ok) {
      throw new ApiError(401, 'WRONG_PASSWORD', 'That password is not correct.', {
        field: 'password',
      });
    }

    const blockers = await closureBlockers(prisma, customer.id);
    if (blockers.length > 0) {
      throw new ApiError(409, 'CLOSURE_BLOCKED', 'This account cannot be closed yet.', {
        blockers,
      });
    }

    await closeAccount(prisma, customer.id);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    sendOk(res, { closed: true });
  }),
);
