"use client";

import { useEffect, createContext, useContext, useState, useCallback } from "react";
import { initLiff, isLoggedIn, getProfile } from "@/lib/liff";

interface LiffContextValue {
  ready: boolean;
  loggedIn: boolean;
  profile: {
    displayName: string;
    pictureUrl?: string;
    userId: string;
  } | null;
}

const LiffContext = createContext<LiffContextValue>({
  ready: false,
  loggedIn: false,
  profile: null,
});

export function useLiff() {
  return useContext(LiffContext);
}

export function LiffProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LiffContextValue>({
    ready: false,
    loggedIn: false,
    profile: null,
  });

  const initialize = useCallback(async () => {
    await initLiff();
    const loggedIn = isLoggedIn();
    const profile = loggedIn ? await getProfile() : null;
    setState({ ready: true, loggedIn, profile });
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
