"use client";

import { useEffect, createContext, useContext, useState, useCallback } from "react";
import { initLiff, isLoggedIn, getProfile, getIdToken, isInLiff, login } from "@/lib/liff";

interface UserInfo {
  id: string;
  displayName: string;
  pictureUrl?: string;
}

interface LiffContextValue {
  ready: boolean;
  user: UserInfo | null;
  loading: boolean;
}

const LiffContext = createContext<LiffContextValue>({
  ready: false,
  user: null,
  loading: true,
});

export function useLiff() {
  return useContext(LiffContext);
}

function hasCookie(name: string): boolean {
  return document.cookie.split(";").some((c) => c.trim().startsWith(name + "="));
}

const RELOAD_KEY = "zhubao_auth_reload";
const MAX_RELOADS = 3;

export function LiffProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LiffContextValue>({
    ready: false,
    user: null,
    loading: true,
  });

  const initialize = useCallback(async () => {
    const alreadyLoggedIn = hasCookie("zhubao_logged_in");

    await initLiff();

    // If in LIFF but not logged in, trigger LINE login
    if (isInLiff() && !isLoggedIn()) {
      login();
      return;
    }

    // If LIFF logged in but no server cookie, authenticate with backend
    if (isLoggedIn() && !alreadyLoggedIn) {
      const idToken = getIdToken();
      if (idToken) {
        try {
          const res = await fetch("/api/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken }),
          });
          if (res.ok) {
            // Reload so server components pick up the cookie
            const reloadCount = parseInt(sessionStorage.getItem(RELOAD_KEY) ?? "0", 10);
            if (reloadCount < MAX_RELOADS) {
              sessionStorage.setItem(RELOAD_KEY, String(reloadCount + 1));
              globalThis.location.reload();
              return;
            }
            // Max reloads reached — show error
            setState({ ready: true, user: null, loading: false });
            return;
          }
        } catch {
          // Fall through to non-auth state
        }
      }
    }

    // If already authenticated, get profile for display
    if (isLoggedIn() && alreadyLoggedIn) {
      // Clear reload counter on successful load
      sessionStorage.removeItem(RELOAD_KEY);

      const profile = await getProfile();
      if (profile) {
        setState({
          ready: true,
          user: {
            id: "",  // ID comes from server, not needed client-side
            displayName: profile.displayName,
            pictureUrl: profile.pictureUrl,
          },
          loading: false,
        });
        return;
      }
    }

    // Not in LIFF or not logged in
    sessionStorage.removeItem(RELOAD_KEY);
    setState({ ready: true, user: null, loading: false });
  }, []);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <LiffContext.Provider value={state}>
      {children}
    </LiffContext.Provider>
  );
}
