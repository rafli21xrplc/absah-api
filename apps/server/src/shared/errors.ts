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

export class UnauthenticatedError extends AppError {
  constructor(message = 'Silakan masuk terlebih dahulu.') {
    super('UNAUTHENTICATED', 401, message);
  }
}

/** Admin and operator must enable TOTP before acting in a school (PLT-01). */
export class TwoFactorRequiredError extends AppError {
  constructor() {
    super('TWO_FACTOR_REQUIRED', 403, 'Aktifkan verifikasi dua langkah untuk melanjutkan.');
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

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super('CONFLICT', 409, message, details);
  }
}

/** Same Idempotency-Key, different request (PLT-13). */
export class IdempotencyKeyReusedError extends AppError {
  constructor() {
    super('IDEMPOTENCY_KEY_REUSED', 422, 'Idempotency-Key sudah dipakai untuk permintaan lain.');
  }
}

/** The first request with this Idempotency-Key has not finished yet (PLT-13). */
export class IdempotencyInProgressError extends AppError {
  constructor() {
    super('IDEMPOTENCY_IN_PROGRESS', 409, 'Permintaan yang sama masih diproses. Coba lagi sebentar.');
  }
}
