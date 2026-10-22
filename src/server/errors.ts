import type { ApiErrorBody, ApiErrorCode } from "@/lib/types";

const HTTP_STATUS: Record<ApiErrorCode, number> = {
  INVALID_URL: 400,
  NOT_FOUND: 404,
  PRIVATE: 403,
  REF_NOT_FOUND: 404,
  EMPTY: 422,
  RATE_LIMITED: 429,
  FORBIDDEN: 403,
  TOO_LARGE: 413,
  UPSTREAM: 502,
  NETWORK: 502,
  TIMEOUT: 504,
  BAD_RESPONSE: 502,
  THROTTLED: 429,
};

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly resetAt?: Date;

  constructor(code: ApiErrorCode, message: string, options?: { resetAt?: Date; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.resetAt = options?.resetAt;
  }

  get status(): number {
    return HTTP_STATUS[this.code];
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.resetAt ? { resetAt: this.resetAt.toISOString() } : {}),
      },
    };
  }
}

export function errorResponse(error: unknown): Response {
  const appError =
    error instanceof AppError
      ? error
      : new AppError("UPSTREAM", "Something went wrong while building the city. Please try again.", { cause: error });
  if (!(error instanceof AppError)) console.error("[gitcity] unexpected error", error);
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (appError.resetAt) {
    headers["Retry-After"] = String(Math.max(1, Math.ceil((appError.resetAt.getTime() - Date.now()) / 1000)));
  }
  return Response.json(appError.toBody(), { status: appError.status, headers });
}
