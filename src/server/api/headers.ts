import { ApiProblem } from "./problem";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const ETAG_PATTERN = /^"([1-9][0-9]*)"$/;

export function parseIfMatch(value: string | null | undefined): number {
  if (!value) {
    throw new ApiProblem({
      status: 428,
      code: "IF_MATCH_REQUIRED",
      title: "缺少版本條件",
      detail: "這個操作需要 If-Match header。",
    });
  }

  const match = ETAG_PATTERN.exec(value);
  const parsed = match ? Number(match[1]) : Number.NaN;
  if (!match || !Number.isSafeInteger(parsed)) {
    throw new ApiProblem({
      status: 422,
      code: "VALIDATION_FAILED",
      title: "版本格式不正確",
      detail: "If-Match 必須是正整數 strong ETag。",
    });
  }

  return parsed;
}

/**
 * Parse the `Idempotency-Key` header for cookie-authenticated staff mutations.
 *
 * Unlike the public-flow {@link parseIdempotencyKey} (which uses 428/422), these
 * mutations report a missing or malformed key as a 400 per the task contract.
 */
export function requireStaffIdempotencyKey(value: string | null | undefined): string {
  if (!value) {
    throw new ApiProblem({
      status: 400,
      code: "IDEMPOTENCY_KEY_REQUIRED",
      title: "缺少冪等鍵",
      detail: "這個操作需要 Idempotency-Key header。",
    });
  }

  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new ApiProblem({
      status: 400,
      code: "IDEMPOTENCY_KEY_INVALID",
      title: "冪等鍵格式不正確",
      detail: "Idempotency-Key 必須是 8 到 128 個安全字元。",
    });
  }

  return value;
}

export function parseIdempotencyKey(value: string | null | undefined): string {
  if (!value) {
    throw new ApiProblem({
      status: 428,
      code: "IDEMPOTENCY_KEY_REQUIRED",
      title: "缺少冪等鍵",
      detail: "這個操作需要 Idempotency-Key header。",
    });
  }

  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new ApiProblem({
      status: 422,
      code: "VALIDATION_FAILED",
      title: "冪等鍵格式不正確",
      detail: "Idempotency-Key 必須是 8 到 128 個安全字元。",
    });
  }

  return value;
}
