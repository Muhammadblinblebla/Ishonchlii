/**
 * API xatolari.
 *
 * Muhim qoida: xato matnida hech qachon parol, token yoki ichki tafsilot
 * bo'lmaydi. Login xatolarida "email topilmadi" va "parol noto'g'ri"
 * FARQLANMAYDI — aks holda hujumchi qaysi emaillar ro'yxatdan o'tganini
 * bitta-bitta aniqlab olishi mumkin.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INVALID_TRANSITION'
  | 'IDEMPOTENCY_MISMATCH'
  | 'INSUFFICIENT_FUNDS'
  | 'INTERNAL';

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, 'VALIDATION_ERROR', message, details);
  }

  static unauthorized(message = 'Avtorizatsiya talab qilinadi'): ApiError {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }

  static forbidden(message = 'Bu amalga ruxsatingiz yo\'q'): ApiError {
    return new ApiError(403, 'FORBIDDEN', message);
  }

  /**
   * §11 (IDOR himoyasi): begona savdo so'ralganda 403 emas, 404 qaytariladi.
   * 403 "bunday savdo bor, lekin sizniki emas" degan ma'lumotni oshkor qiladi.
   */
  static notFound(message = 'Topilmadi'): ApiError {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  static conflict(message: string, details?: unknown): ApiError {
    return new ApiError(409, 'CONFLICT', message, details);
  }

  static invalidTransition(message: string, details?: unknown): ApiError {
    return new ApiError(409, 'INVALID_TRANSITION', message, details);
  }

  static idempotencyMismatch(message: string): ApiError {
    return new ApiError(422, 'IDEMPOTENCY_MISMATCH', message);
  }
}
