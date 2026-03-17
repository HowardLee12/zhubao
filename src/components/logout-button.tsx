"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { logout as liffLogout } from "@/lib/liff";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    if (!globalThis.confirm("確定要登出嗎？")) return;

    setLoading(true);
    try {
      // Clear session cookies
      document.cookie = "zhubao_session=; path=/; max-age=0";
      document.cookie = "zhubao_logged_in=; path=/; max-age=0";

      // Logout from LIFF
      liffLogout();

      router.refresh();
    } catch {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      className="w-full text-center py-3 text-sm text-destructive font-medium disabled:opacity-50"
    >
      {loading ? "登出中..." : "登出"}
    </button>
  );
}
