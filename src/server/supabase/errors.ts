import { ApiProblem } from "@/server/api/problem";

interface PostgrestErrorLike {
  code?: unknown;
  message?: unknown;
  details?: unknown;
}

export function mapCreateOrganizationError(error: unknown): ApiProblem {
  const candidate = error as PostgrestErrorLike | null;
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const message =
    typeof candidate?.message === "string" ? candidate.message : "";
  const details =
    typeof candidate?.details === "string" ? candidate.details : "";
  const combined = `${message} ${details}`;

  // create_pilot_organization re-raises every unique_violation in its body as
  // PILOT_ORGANIZATION_CONFLICT; the slug unique index is the only
  // caller-reachable one (the idempotency insert is ON CONFLICT DO NOTHING and
  // all other inserts target the freshly created organization).
  const isSlugConflict =
    (code === "23505" &&
      (combined.includes("organizations_slug_lower_uidx") ||
        combined.includes("(slug)") ||
        combined.includes("PILOT_ORGANIZATION_CONFLICT"))) ||
    combined.includes("SLUG_TAKEN");

  if (isSlugConflict) {
    return new ApiProblem({
      status: 409,
      code: "SLUG_TAKEN",
      title: "網址代稱已被使用",
      detail: "請換一個店家網址代稱後再試一次。",
    });
  }

  if (combined.includes("PILOT_IDEMPOTENCY_CONFLICT")) {
    return new ApiProblem({
      status: 409,
      code: "IDEMPOTENCY_CONFLICT",
      title: "重複要求內容不一致",
      detail: "這個冪等鍵已用於不同內容的要求，請重新整理頁面後再試。",
    });
  }

  if (combined.includes("PILOT_IDEMPOTENCY_IN_PROGRESS")) {
    return new ApiProblem({
      status: 409,
      code: "IDEMPOTENCY_IN_PROGRESS",
      title: "要求處理中",
      detail: "先前的要求仍在處理，請稍後再試一次。",
    });
  }

  return new ApiProblem({
    status: 500,
    code: "INTERNAL_ERROR",
    title: "系統暫時無法建立店家",
    detail: "系統暫時無法建立店家，請稍後再試。",
  });
}
