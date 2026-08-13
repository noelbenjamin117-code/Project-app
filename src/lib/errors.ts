/**
 * Domain errors carry the HTTP status they should surface as, so route
 * handlers can translate a thrown rule violation into a response without every
 * handler re-deriving the mapping.
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
    readonly code: string = 'BAD_REQUEST',
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const unauthorized = (message = 'You need to sign in.') =>
  new AppError(message, 401, 'UNAUTHORIZED');

export const forbidden = (message = 'You do not have access to that.') =>
  new AppError(message, 403, 'FORBIDDEN');

export const notFound = (message = 'Not found.') => new AppError(message, 404, 'NOT_FOUND');

export const conflict = (message: string, code = 'CONFLICT') => new AppError(message, 409, code);

export function toErrorResponse(error: unknown): { status: number; body: { error: string; code: string } } {
  if (error instanceof AppError) {
    return { status: error.status, body: { error: error.message, code: error.code } };
  }
  console.error('Unhandled error', error);
  return {
    status: 500,
    body: { error: 'Something went wrong.', code: 'INTERNAL' },
  };
}
