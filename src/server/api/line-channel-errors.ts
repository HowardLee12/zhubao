import { ApiProblem } from "./problem";
import { internalApiProblem } from "@/server/supabase/http";

interface RpcErrorLike {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
}

function combined(error: RpcErrorLike): string {
  return `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`;
}

// Maps a LINE-channel RPC exception to an RFC-9457 problem. FORBIDDEN -> 403;
// missing/cross-tenant channel -> non-leaky 404; a unique violation on a duplicate
// channel_id -> 409. Everything else is a generic 500 with no internal detail.
export function mapLineChannelRpcError(error: RpcErrorLike): ApiProblem {
  const value = combined(error);

  if (value.includes("FORBIDDEN")) {
    return new ApiProblem({
      status: 403,
      code: "FORBIDDEN",
      title: "沒有權限",
      detail: "只有負責人或管理員可以管理 LINE 官方帳號連接。",
    });
  }

  if (value.includes("LINE_CHANNEL_NOT_FOUND")) {
    return new ApiProblem({
      status: 404,
      code: "NOT_FOUND",
      title: "找不到 LINE 頻道",
      detail: "找不到這個 LINE 頻道，或它不屬於這個組織。",
    });
  }

  if (error.code === "23505" || value.includes("line_channels_channel_id_uidx")) {
    return new ApiProblem({
      status: 409,
      code: "CONFLICT",
      title: "此 LINE 頻道已被連接",
      detail: "這個 LINE Channel ID 已經被其他組織連接。",
    });
  }

  return internalApiProblem();
}
