import { toProblemDetails } from "./problem";

interface ResponseContext {
  instance: string;
  requestId: string;
}

interface DataResponseOptions extends ResponseContext {
  status?: number;
  headers?: HeadersInit;
  meta?: unknown;
}

function responseHeaders(requestId: string, initial?: HeadersInit): Headers {
  const headers = new Headers(initial);
  headers.set("cache-control", "no-store");
  headers.set("x-request-id", requestId);
  return headers;
}

export function dataResponse<T>(data: T, options: DataResponseOptions): Response {
  return Response.json(
    {
      data,
      ...(options.meta === undefined ? {} : { meta: options.meta }),
    },
    {
      status: options.status ?? 200,
      headers: responseHeaders(options.requestId, options.headers),
    },
  );
}

export function problemResponse(error: unknown, context: ResponseContext): Response {
  const details = toProblemDetails(error, context);
  const headers = responseHeaders(context.requestId, {
    "content-type": "application/problem+json; charset=utf-8",
  });

  return new Response(JSON.stringify(details), {
    status: details.status,
    headers,
  });
}
