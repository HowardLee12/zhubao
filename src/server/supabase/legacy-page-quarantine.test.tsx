import { describe, expect, it } from "vitest";

import LegacyAuthenticatedLayout from "@/app/(auth)/layout";

describe("incompatible v1 page quarantine", () => {
  it("not-founds the complete old authenticated route group", () => {
    expect(() => LegacyAuthenticatedLayout({ children: <div>legacy</div> })).toThrow(/404/);
  });
});
