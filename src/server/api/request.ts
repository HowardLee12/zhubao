import { randomUUID } from "node:crypto";
import type { ZodType } from "zod";

import { ApiProblem } from "./problem";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveRequestId(candidate: string | null | undefined): string {
  return candidate && UUID_PATTERN.test(candidate) ? candidate : randomUUID();
}

function payloadTooLarge(): ApiProblem {
  return new ApiProblem({
    status: 413,
    code: "PAYLOAD_TOO_LARGE",
    title: "資料量過大",
    detail: "Request body exceeds the endpoint limit.",
  });
}

async function readBoundedBody(request: Request, maxBytes: number): Promise<string> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
    throw payloadTooLarge();
  }

  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maxBytes) {
      await reader.cancel();
      throw payloadTooLarge();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>,
  options: { maxBytes?: number } = {},
): Promise<T> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new ApiProblem({
      status: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
      title: "不支援的資料格式",
      detail: "Request body must use application/json.",
    });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readBoundedBody(request, options.maxBytes ?? 1024 * 1024));
  } catch (error) {
    if (error instanceof ApiProblem) throw error;
    throw new ApiProblem({
      status: 400,
      code: "MALFORMED_REQUEST",
      title: "要求格式錯誤",
      detail: "Request body must be valid JSON.",
    });
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw ApiProblem.fromZod(result.error);
  }

  return result.data;
}
