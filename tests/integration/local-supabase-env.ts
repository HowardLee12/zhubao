import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface LocalSupabaseEnv {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  dbUrl: string;
  jwtSecret: string;
}

// Integration tests must run against the real local Supabase stack. The
// `test:integration` npm script does not wrap the process with
// scripts/with-local-supabase.mjs, so we resolve the credentials here at
// runtime the same way that wrapper does. If the stack is not reachable we
// throw a loud, actionable error instead of silently skipping.
export function resolveLocalSupabaseEnv(): LocalSupabaseEnv {
  const cliHome = join(tmpdir(), "renoly-supabase-cli");
  mkdirSync(cliHome, { recursive: true });

  const status = spawnSync("npx", ["supabase", "status", "-o", "env"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, HOME: cliHome },
  });

  if (status.status !== 0) {
    throw new Error(
      "Local Supabase is not running. Start it with `npx supabase start` before " +
        `running integration tests. CLI output:\n${status.stderr || status.stdout || "(none)"}`,
    );
  }

  const values: Record<string, string> = {};
  for (const line of status.stdout.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)="(.*)"$/.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }

  const apiUrl = values.API_URL;
  const anonKey = values.ANON_KEY;
  const serviceRoleKey = values.SERVICE_ROLE_KEY;
  const dbUrl = values.DB_URL;
  const jwtSecret = values.JWT_SECRET;

  if (!apiUrl || !anonKey || !serviceRoleKey || !dbUrl || !jwtSecret) {
    throw new Error(
      "Local Supabase status did not expose the required credentials " +
        "(API_URL, ANON_KEY, SERVICE_ROLE_KEY, DB_URL, JWT_SECRET). " +
        "Ensure the local stack is fully started.",
    );
  }

  return { apiUrl, anonKey, serviceRoleKey, dbUrl, jwtSecret };
}

// Executes a single SQL statement against the local database as the postgres
// superuser via psql. Used only to seed test fixtures (public capability
// tokens) the same way the pgTAP suite does; the production flow mints these
// through create_pilot_organization.
export function execLocalSql(dbUrl: string, sql: string): void {
  const result = spawnSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `Failed to seed local SQL fixture. psql output:\n${result.stderr || result.stdout || "(none)"}`,
    );
  }
}
