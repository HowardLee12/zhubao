import { resolveRequestId } from "@/server/api/request";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  return Response.json(
    {
      data: {
        status: "ok",
        version: "v2",
        time: new Date().toISOString(),
      },
    },
    {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "x-request-id": requestId,
      },
    },
  );
}
