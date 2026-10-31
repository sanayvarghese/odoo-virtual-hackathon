/**
 * Centralised application error type used across routes and services.
 * Routes/services throw AppError; the Fastify error handler (app.ts) maps it
 * to a consistent JSON envelope: { error: { message, code, details? } }.
 */
export type AppErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'business_rule'
  | 'rate_limited'
  | 'internal';

export interface AppErrorDetail {
  path?: string;
  message: string;
  row?: number;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly statusCode: number;
  readonly details?: AppErrorDetail[];

  constructor(
    code: AppErrorCode,
    message: string,
    opts: { statusCode?: number; details?: AppErrorDetail[] } = {},
  ) {
    super(message);
    this.code = code;
    this.statusCode = opts.statusCode ?? statusCodeFor(code);
    this.details = opts.details;
  }
}

function statusCodeFor(code: AppErrorCode): number {
  switch (code) {
    case 'validation_error':
      return 400;
    case 'unauthorized':
      return 401;
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'conflict':
      return 409;
    case 'business_rule':
      return 422;
    case 'rate_limited':
      return 429;
    default:
      return 500;
  }
}

export function badRequest(message: string, details?: AppErrorDetail[]): AppError {
  return new AppError('validation_error', message, { details });
}

export function unauthorized(message = 'You need to sign in to continue.'): AppError {
  return new AppError('unauthorized', message);
}

export function forbidden(message = 'You do not have permission to do that.'): AppError {
  return new AppError('forbidden', message);
}

export function notFound(message = 'Not found.'): AppError {
  return new AppError('not_found', message);
}

export function conflict(message: string, details?: AppErrorDetail[]): AppError {
  return new AppError('conflict', message, { details });
}

export function businessRule(message: string, details?: AppErrorDetail[]): AppError {
  return new AppError('business_rule', message, { details });
}
