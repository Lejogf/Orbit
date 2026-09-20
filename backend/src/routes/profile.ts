// Identity changes, trusted contact, username and accessibility settings.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { recordActivity, recentActivity, upsertProfile } from '../services/documents.js';
import { mongoStatus } from '../services/mongo.js';
import { ApiError, asyncRoute, param, sendOk } from '../lib/http.js';
import { requireCustomer } from '../middleware/session.js';
import { NAME_CHANGE_REASONS } from '../features/profileChange.js';
import {
  approveNameChange,
  cancelChangeRequest,
  listChangeRequests,
  requestNameChange,
  startAddressChange,
  verifyAddressChange,
} from '../services/profile.js';
import { normaliseUsername, checkUsername } from '../services/auth.js';

export const profileRouter = Router();

profileRouter.get(
  '/profile/requests',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, { requests: await listChangeRequests(prisma, customer.id), reasons: NAME_CHANGE_REASONS });
  }),
);

profileRouter.post(
  '/profile/address',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const body = z
      .object({
        line1: z.string().max(120),
        line2: z.string().max(120).nullable().optional(),
        city: z.string().max(80),
        state: z.string().max(40),
        postalCode: z.string().max(12),
      })
      .parse(req.body);
    sendOk(res, await startAddressChange(prisma, customer, body), 201);
  }),
);

profileRouter.post(
  '/profile/address/verify',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const { requestId, code } = z.object({ requestId: z.string().min(1).max(40), code: z.string().min(4).max(12) }).parse(req.body);
    sendOk(res, await verifyAddressChange(prisma, customer, requestId, code));
  }),
);

profileRouter.post(
  '/profile/name',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const body = z
      .object({
        firstName: z.string().max(60),
        lastName: z.string().max(80),
        middleName: z.string().max(60).nullable().optional(),
        reason: z.enum(NAME_CHANGE_REASONS.map((r) => r.id) as [string, ...string[]]),
        document: z.object({ name: z.string().max(200), type: z.string().max(100), size: z.number().int().min(0) }),
      })
      .parse(req.body);
    sendOk(res, await requestNameChange(prisma, customer, body as Parameters<typeof requestNameChange>[2]), 201);
  }),
);

profileRouter.post(
  '/profile/requests/:id/approve',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, await approveNameChange(prisma, customer, param(req, 'id')));
  }),
);

profileRouter.post(
  '/profile/requests/:id/cancel',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, await cancelChangeRequest(prisma, customer.id, param(req, 'id')));
  }),
);

profileRouter.patch(
  '/profile/trusted-contact',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const body = z
      .object({
        name: z.string().trim().max(80).nullable(),
        phone: z.string().trim().max(30).nullable(),
      })
      .parse(req.body);
    if (body.phone && body.phone.replace(/\D/g, '').length < 10) {
      throw new ApiError(400, 'INVALID_PHONE', 'Enter a 10-digit phone number.', { field: 'trustedPhone' });
    }
    const updated = await prisma.customer.update({
      where: { id: customer.id },
      data: { trustedContactName: body.name || null, trustedContactPhone: body.phone || null },
    });
    sendOk(res, { name: updated.trustedContactName, phone: updated.trustedContactPhone });
  }),
);

profileRouter.patch(
  '/profile/username',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const { username } = z.object({ username: z.string().max(40) }).parse(req.body);
    const value = normaliseUsername(username);
    const problem = checkUsername(value);
    if (problem) throw new ApiError(400, 'INVALID_USERNAME', problem, { field: 'username' });

    const taken = await prisma.customer.findFirst({ where: { username: value, NOT: { id: customer.id } } });
    if (taken) throw new ApiError(409, 'USERNAME_TAKEN', 'That username is taken. Try another.', { field: 'username' });

    await prisma.customer.update({ where: { id: customer.id }, data: { username: value } });
    sendOk(res, { username: value });
  }),
);

// --- accessibility ---

export const accessibilitySchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  textScale: z.number().min(1).max(2).default(1),
  contrast: z.enum(['standard', 'high']).default('standard'),
  font: z.enum(['default', 'readable', 'dyslexic']).default('default'),
  lineSpacing: z.enum(['normal', 'relaxed']).default('normal'),
  motion: z.enum(['system', 'reduce']).default('system'),
  simpleMode: z.boolean().default(false),
  underlineLinks: z.boolean().default(false),
  largeTargets: z.boolean().default(false),
  colorSafe: z.boolean().default(false),
  focusRing: z.enum(['standard', 'strong']).default('standard'),
  language: z.enum(['en', 'es']).default('en'),
  readAloudRate: z.number().min(0.5).max(1.5).default(1),
  confirmMoney: z.boolean().default(true),
  sessionMinutes: z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(120)]).default(30),
  oriVoice: z.boolean().default(false),
});

profileRouter.get(
  '/profile/accessibility',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const prefs = await prisma.preference.findUnique({ where: { customerId: customer.id } });
    const stored = prefs?.accessibility ? (JSON.parse(prefs.accessibility) as unknown) : {};
    // Anything malformed falls back to defaults rather than breaking the app.
    const parsed = accessibilitySchema.safeParse(stored);
    sendOk(res, parsed.success ? parsed.data : accessibilitySchema.parse({}));
  }),
);

profileRouter.put(
  '/profile/accessibility',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const settings = accessibilitySchema.parse(req.body);
    await prisma.preference.upsert({
      where: { customerId: customer.id },
      update: { accessibility: JSON.stringify(settings) },
      create: { customerId: customer.id, accessibility: JSON.stringify(settings) },
    });

    // Mirrored into the customer's profile document, where support can read it
    // before they join a chat — the needs travel with the person, not the page.
    void upsertProfile(customer.id, {
      displayName: `${customer.firstName} ${customer.lastName}`,
      accessibility: settings as Record<string, unknown>,
    });
    void recordActivity(customer.id, 'accessibility_changed', 'Accessibility settings updated', settings as Record<string, unknown>);

    sendOk(res, settings);
  }),
);

/**
 * Everything that has happened on this account lately, from the Atlas activity
 * stream. Not the ledger — that is Accounts. This is the "what did I change?"
 * view: settings, invites, plans, locks.
 */
profileRouter.get(
  '/profile/activity',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const events = await recentActivity(customer.id, 50);
    sendOk(res, {
      events: events.map((e) => ({
        kind: e.kind,
        summary: e.summary,
        detail: e.detail ?? null,
        at: e.at instanceof Date ? e.at.toISOString() : String(e.at),
      })),
      // Says plainly when the stream is empty because there is no cluster,
      // rather than implying nothing has happened.
      store: mongoStatus(),
    });
  }),
);
