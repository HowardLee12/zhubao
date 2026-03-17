"use client";

import { useEffect, createContext, useContext, useState, useCallback } from "react";
import { initLiff, isLoggedIn, getProfile, getAccessToken, isInitialized, login } from "@/lib/liff";

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
    try {
      const alreadyLoggedIn = hasCookie("zhubao_logged_in");

      await initLiff();

      // If LIFF initialized but not logged in, trigger LINE login
      if (isInitialized() && !isLoggedIn()) {
        login();
        return;
      }

      // If LIFF logged in but no server cookie, authenticate with backend
      if (isLoggedIn() && !alreadyLoggedIn) {
        const accessToken = getAccessToken();
        if (accessToken) {
          try {
            const res = await fetch("/api/auth", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ accessToken }),
            });

            if (res.ok) {
              const reloadCount = Number.parseInt(sessionStorage.getItem(RELOAD_KEY) ?? "0", 10);
              if (reloadCount < MAX_RELOADS) {
                sessionStorage.setItem(RELOAD_KEY, String(reloadCount + 1));
                globalThis.location.reload();
                return;
              }
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
        sessionStorage.removeItem(RELOAD_KEY);

        const profile = await getProfile();
        if (profile) {
          setState({
            ready: true,
            user: {
              id: "",
              displayName: profile.displayName,
              pictureUrl: profile.pictureUrl,
            },
            loading: false,
          });
          return;
        }
      }

      sessionStorage.removeItem(RELOAD_KEY);
      setState({ ready: true, user: null, loading: false });
    } catch {
      setState({ ready: true, user: null, loading: false });
    }
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
