import { ZodError } from "zod";

export type ApiProblemCode =
  | "MALFORMED_REQUEST"
  | "VALIDATION_FAILED"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "INVALID_STATE_TRANSITION"
  | "INTERNAL_ERROR"
  | (string & {});

export interface ProblemFieldError {
  path: string;
  code: string;
  message: string;
}

export interface ApiProblemOptions {
  status: number;
  code: ApiProblemCode;
  title: string;
  detail: string;
  errors?: ProblemFieldError[];
}

export interface ProblemDetails extends ApiProblemOptions {
  type: string;
  instance: string;
  requestId: string;
}

export class ApiProblem extends Error {
  readonly status: number;
  readonly code: ApiProblemCode;
  readonly title: string;
  readonly detail: string;
  readonly errors?: ProblemFieldError[];

  constructor(options: ApiProblemOptions) {
    super(options.detail);
    this.name = "ApiProblem";
    this.status = options.status;
    this.code = options.code;
    this.title = options.title;
    this.detail = options.detail;
    this.errors = options.errors;
  }

  static fromZod(error: ZodError): ApiProblem {
    return new ApiProblem({
      status: 422,
      code: "VALIDATION_FAILED",
      title: "輸入資料不正確",
      detail: "請修正標示欄位後再試一次。",
      errors: error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code.toUpperCase(),
        message: issue.message,
      })),
    });
  }
}

function problemSlug(code: string): string {
  return code.toLowerCase().replaceAll("_", "-");
}

export function toProblemDetails(
  error: unknown,
  context: { instance: string; requestId: string },
): ProblemDetails {
  const problem =
    error instanceof ApiProblem
      ? error
      : new ApiProblem({
          status: 500,
          code: "INTERNAL_ERROR",
          title: "系統暫時無法處理要求",
          detail: "系統暫時無法處理要求，請稍後再試。",
        });

  return {
    type: `https://renoly.app/problems/${problemSlug(problem.code)}`,
    title: problem.title,
    status: problem.status,
    detail: problem.detail,
    code: problem.code,
    instance: context.instance,
    requestId: context.requestId,
    ...(problem.errors ? { errors: problem.errors } : {}),
  };
}
