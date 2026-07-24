"use client";

import { useSyncExternalStore } from "react";

import { PilotPublicQuote } from "./public-quote";
import { PilotBrand, PilotLoading, PilotPage } from "./ui";

const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Read the capability from the URL fragment. Fragments are never sent in the
 * HTTP request line, so the raw quote token stays out of page/access logs.
 */
export function PilotPublicQuoteFromFragment() {
  const candidate = useSyncExternalStore(
    (onStoreChange) => {
      globalThis.addEventListener("hashchange", onStoreChange);
      return () => globalThis.removeEventListener("hashchange", onStoreChange);
    },
    () => globalThis.location.hash.slice(1),
    () => null,
  );

  if (candidate === null) {
    return (
      <PilotPage>
        <PilotBrand eyebrow="客戶報價" />
        <PilotLoading label="正在開啟安全報價" />
      </PilotPage>
    );
  }

  const token = CAPABILITY_PATTERN.test(candidate) ? candidate : null;
  return <PilotPublicQuote token={token ?? "invalid"} />;
}
