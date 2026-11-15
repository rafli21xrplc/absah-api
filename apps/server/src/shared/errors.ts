import type { ErrorCode } from '@absah/contracts';

/** Domain/application errors with a stable code. The HTTP layer maps them to responses. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown, message = 'Data yang dikirim tidak valid.') {
    super('VALIDATION_FAILED', 400, message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Tidak ditemukan.') {
    super('NOT_FOUND', 404, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Anda tidak memiliki akses.') {
    super('FORBIDDEN', 403, message);
  }
}

/** Disabled capabilities look like missing routes (404) so clients cannot probe feature sets. */
export class CapabilityDisabledError extends AppError {
  constructor(key: string) {
    super('CAPABILITY_DISABLED', 404, 'Fitur ini tidak aktif untuk sekolah Anda.', { capability: key });
  }
}
