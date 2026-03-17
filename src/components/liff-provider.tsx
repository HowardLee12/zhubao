"use client";

import { useEffect, createContext, useContext, useState, useCallback } from "react";
import { initLiff, isLoggedIn, getProfile, isInLiff, login } from "@/lib/liff";

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

export function LiffProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LiffContextValue>({
    ready: false,
    user: null,
    loading: true,
  });

  const initialize = useCallback(async () => {
    await initLiff();

    // If in LIFF but not logged in, trigger login
    if (isInLiff() && !isLoggedIn()) {
      login();
      return;
    }

    // If logged in, get profile and register/login with our backend
    if (isLoggedIn()) {
      const profile = await getProfile();
      if (profile) {
        try {
          const res = await fetch("/api/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lineUserId: profile.userId,
              displayName: profile.displayName,
              pictureUrl: profile.pictureUrl ?? "",
            }),
          });
          if (res.ok) {
            const data = await res.json();
            setState({
              ready: true,
              user: {
                id: data.id,
                displayName: data.displayName,
                pictureUrl: data.pictureUrl,
              },
              loading: false,
            });
            return;
          }
        } catch {
          // Fall through to non-auth state
        }
      }
    }

    // Not in LIFF or not logged in — still allow access (browser mode)
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
