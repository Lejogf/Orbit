// Pay Over Time routes.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireCustomer } from '../middleware/session.js';
import { ApiError, asyncRoute, param, sendOk } from '../lib/http.js';
import * as plans from '../services/plans.js';
import { TERMS, type Term } from '../features/pricing.js';

export const plansRouter = Router();

/** Quote every term for one purchase, with affordability and credit impact. */
plansRouter.get(
  '/transactions/:id/plan-options',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const options = await plans.quoteForTransaction(prisma, customer.id, param(req, 'id'));
    if (!options) throw ApiError.notFound('Transaction');
    sendOk(res, options);
  }),
);

plansRouter.post(
  '/plans',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const body = z
      .object({
        transactionId: z.string().min(1),
        termMonths: z.union([z.literal(3), z.literal(6), z.literal(12), z.literal(24)]),
      })
      .parse(req.body);

    const result = await plans.createPlan(
      prisma,
      customer.id,
      body.transactionId,
      body.termMonths as Term,
    );

    if ('error' in result) throw ApiError.badRequest(result.error);
    sendOk(res, result.plan, 201);
  }),
);

plansRouter.get(
  '/plans',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const all = await plans.listPlans(prisma, customer.id);
    const active = all.filter((p) => p.status === 'active');

    sendOk(res, {
      plans: all,
      summary: {
        activeCount: active.length,
        monthlyTotalCents: active.reduce((sum, p) => sum + p.monthlyPaymentCents, 0),
        financedCents: active.reduce((sum, p) => sum + p.principalCents, 0),
        remainingCents: active.reduce(
          (sum, p) =>
            sum + p.payments.filter((i) => i.status === 'scheduled').reduce((s, i) => s + i.amountCents, 0),
          0,
        ),
        maxPlans: plans.PRICING.limits.maxActivePlans,
        terms: TERMS,
      },
    });
  }),
);

plansRouter.get(
  '/plans/:id',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const plan = await plans.getPlan(prisma, param(req, 'id'), customer.id);
    if (!plan) throw ApiError.notFound('Plan');
    sendOk(res, plan);
  }),
);

plansRouter.post(
  '/plans/:id/pay',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const { mode } = z.object({ mode: z.enum(['next', 'payoff']) }).parse(req.body);

    // Confirm ownership before mutating.
    if (!(await plans.getPlan(prisma, param(req, 'id'), customer.id))) {
      throw ApiError.notFound('Plan');
    }

    if (mode === 'payoff') {
      const result = await plans.payOffEarly(prisma, param(req, 'id'));
      if (!result) throw ApiError.notFound('Plan');
      return sendOk(res, result);
    }

    const plan = await plans.payInstallment(prisma, param(req, 'id'));
    if (!plan) throw ApiError.notFound('Plan');
    sendOk(res, { plan });
  }),
);
