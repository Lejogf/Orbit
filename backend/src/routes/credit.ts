// Credit score estimate and what-if simulation.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncRoute, sendOk } from '../lib/http.js';
import { requireCustomer } from '../middleware/session.js';
import { getCreditReport, simulateScenarios } from '../services/credit.js';
import { FACTOR_WEIGHTS, SCORE_MAX, SCORE_MIN } from '../features/creditScore.js';

export const creditRouter = Router();

creditRouter.get(
  '/credit',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const report = await getCreditReport(prisma, customer.id);

    sendOk(res, {
      ...report,
      range: { min: SCORE_MIN, max: SCORE_MAX },
      weights: FACTOR_WEIGHTS,
      // Stated in the payload as well as the UI: this is not a bureau score.
      disclaimer:
        'An estimate based on the accounts Orbit can see, using the published FICO factor weights. Your real score also reflects accounts at other lenders, credit checks and public records, which we cannot see.',
    });
  }),
);

const scenarioIds = z.array(
  z.enum([
    'pay_off_card',
    'pay_half_card',
    'split_purchase',
    'miss_payment',
    'block_subscriptions',
    'open_new_card',
    'wait_a_year',
  ]),
);

creditRouter.post(
  '/credit/simulate',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const { scenarios } = z.object({ scenarios: scenarioIds.max(7) }).parse(req.body);
    sendOk(res, await simulateScenarios(prisma, customer.id, scenarios));
  }),
);
