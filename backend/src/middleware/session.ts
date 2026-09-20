// Reads the session cookie and resolves the signed-in customer.
import type { Request } from 'express';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/http.js';
import { SESSION_COOKIE, customerForToken } from '../services/auth.js';

/** The signed-in customer, or null when there is no valid session. */
export async function currentCustomer(req: Request) {
  return customerForToken(prisma, req.cookies?.[SESSION_COOKIE]);
}

/**
 * The signed-in customer, or a 401. Routes that need a user call this so the
 * unauthenticated case is handled in one place rather than at every call site.
 */
export async function requireCustomer(req: Request) {
  const customer = await currentCustomer(req);
  if (!customer) {
    throw new ApiError(401, 'NOT_SIGNED_IN', 'Sign in to continue.');
  }
  return customer;
}
