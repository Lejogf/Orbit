// Response envelope, typed errors, and the Express error handler.
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { NessieError, redact } from '../nessie/client.js';
import type { ApiFailure, ApiResponse } from '../domain/types.js';

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static notFound(what: string): ApiError {
    return new ApiError(404, 'NOT_FOUND', `${what} not found`);
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }
}

/**
 * Reads a route parameter. Express types these as possibly-undefined under
 * noUncheckedIndexedAccess, so this narrows once instead of at every call site.
 */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (!value) throw ApiError.badRequest(`Missing ${name} in the URL.`);
  return value;
}

export function sendOk<T>(res: Response, data: T, statusCode = 200): void {
  const body: ApiResponse<T> = { success: true, data };
  res.status(statusCode).json(body);
}

/** Without this, a rejected promise in a handler hangs the request. */
export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

function fail(res: Response, status: number, code: string, message: string, details?: unknown): void {
  const body: ApiFailure = { success: false, error: { code, message, details } };
  res.status(status).json(body);
}

export function notFoundHandler(req: Request, res: Response): void {
  fail(res, 404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`);
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  // Express detects an error handler by its 4-arg signature, so `next` must stay.
  _next: NextFunction,
): void {
  if (error instanceof ZodError) {
    fail(res, 400, 'VALIDATION_ERROR', 'Request validation failed', error.flatten());
    return;
  }

  if (error instanceof ApiError) {
    fail(res, error.statusCode, error.code, error.message, error.details);
    return;
  }

  if (error instanceof NessieError) {
    console.error('[error] Nessie:', redact(error.message), error.body ?? '');
    fail(res, 502, 'UPSTREAM_ERROR', 'The banking data service is temporarily unavailable.');
    return;
  }

  // Log everything, reveal nothing.
  console.error('[error] Unhandled:', error);
  fail(res, 500, 'INTERNAL_ERROR', 'Something went wrong on our end.');
}
