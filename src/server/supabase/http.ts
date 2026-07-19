import { ApiProblem, toProblemDetails } from "@/server/api/problem";

const NO_STORE_HEADERS = {
  "cache-control": "private, no-store",
  pragma: "no-cache",
} as const;

export function apiJsonResponse(
  data: unknown,
  options: {
    status?: number;
    requestId: string;
    headers?: HeadersInit;
  },
): Response {
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("x-request-id", options.requestId);
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    headers.set(name, value);
  }

  return new Response(JSON.stringify(data), {
    status: options.status ?? 200,
    headers,
  });
}

export function apiProblemResponse(
  error: unknown,
  request: Request,
  requestId: string,
): Response {
  const problem = toProblemDetails(error, {
    instance: new URL(request.url).pathname,
    requestId,
  });

  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: {
      ...NO_STORE_HEADERS,
      "content-type": "application/problem+json; charset=utf-8",
      "x-request-id": requestId,
    },
  });
}

export function authenticationRequiredProblem(): ApiProblem {
  return new ApiProblem({
    status: 401,
    code: "AUTHENTICATION_REQUIRED",
    title: "需要登入",
    detail: "請先登入後再試一次。",
  });
}

export function internalApiProblem(): ApiProblem {
  return new ApiProblem({
    status: 500,
    code: "INTERNAL_ERROR",
    title: "系統暫時無法處理要求",
    detail: "系統暫時無法處理要求，請稍後再試。",
  });
}
