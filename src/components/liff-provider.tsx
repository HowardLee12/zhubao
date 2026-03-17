"use client";

import { useEffect, createContext, useContext, useState, useCallback } from "react";
import { initLiff, isLoggedIn, getProfile, getAccessToken, isInLiff, login } from "@/lib/liff";

interface UserInfo {
  id: string;
  displayName: string;
  pictureUrl?: string;
}

interface LiffContextValue {
  ready: boolean;
  user: UserInfo | null;
  loading: boolean;
  debugLog: string[];
}

const LiffContext = createContext<LiffContextValue>({
  ready: false,
  user: null,
  loading: true,
  debugLog: [],
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
    debugLog: [],
  });

  const initialize = useCallback(async () => {
    const log: string[] = [];
    const addLog = (msg: string) => {
      log.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
      setState((prev) => ({ ...prev, debugLog: [...log] }));
    };

    try {
      const alreadyLoggedIn = hasCookie("zhubao_logged_in");
      addLog(`cookie zhubao_logged_in: ${alreadyLoggedIn}`);
      addLog(`LIFF_ID: ${process.env.NEXT_PUBLIC_LIFF_ID ?? "(empty)"}`);

      addLog("initLiff()...");
      await initLiff();
      addLog(`initLiff done. isInLiff=${isInLiff()}, isLoggedIn=${isLoggedIn()}`);

      // If in LIFF but not logged in, trigger LINE login
      if (isInLiff() && !isLoggedIn()) {
        addLog("In LIFF but not logged in → calling login()");
        login();
        return;
      }

      // If LIFF logged in but no server cookie, authenticate with backend
      if (isLoggedIn() && !alreadyLoggedIn) {
        const accessToken = getAccessToken();
        addLog(`accessToken: ${accessToken ? accessToken.substring(0, 10) + "..." : "null"}`);

        if (accessToken) {
          addLog("POST /api/auth...");
          try {
            const res = await fetch("/api/auth", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ accessToken }),
            });
            addLog(`/api/auth response: ${res.status}`);

            if (res.ok) {
              const reloadCount = parseInt(sessionStorage.getItem(RELOAD_KEY) ?? "0", 10);
              addLog(`reloadCount: ${reloadCount}/${MAX_RELOADS}`);

              if (reloadCount < MAX_RELOADS) {
                sessionStorage.setItem(RELOAD_KEY, String(reloadCount + 1));
                addLog("Reloading page...");
                globalThis.location.reload();
                return;
              }
              addLog("Max reloads reached — stuck");
              setState({ ready: true, user: null, loading: false, debugLog: log });
              return;
            } else {
              const errText = await res.text();
              addLog(`/api/auth error body: ${errText}`);
            }
          } catch (err) {
            addLog(`/api/auth fetch error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      // If already authenticated, get profile for display
      if (isLoggedIn() && alreadyLoggedIn) {
        sessionStorage.removeItem(RELOAD_KEY);
        addLog("Has cookie + logged in → getProfile()...");

        const profile = await getProfile();
        addLog(`profile: ${profile ? profile.displayName : "null"}`);

        if (profile) {
          setState({
            ready: true,
            user: {
              id: "",
              displayName: profile.displayName,
              pictureUrl: profile.pictureUrl,
            },
            loading: false,
            debugLog: log,
          });
          return;
        }
      }

      addLog("Final state: not authenticated");
      sessionStorage.removeItem(RELOAD_KEY);
      setState({ ready: true, user: null, loading: false, debugLog: log });
    } catch (err) {
      log.push(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
      setState({ ready: true, user: null, loading: false, debugLog: log });
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
