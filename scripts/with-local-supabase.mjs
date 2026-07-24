import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [, , command, ...args] = process.argv;

if (!command) {
  process.stderr.write(
    "Usage: node scripts/with-local-supabase.mjs <command> [...args]\n",
  );
  process.exit(2);
}

const cliHome = join(tmpdir(), "renoly-supabase-cli");
mkdirSync(cliHome, { recursive: true });

const status = spawnSync("npx", ["supabase", "status", "-o", "env"], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: { ...process.env, HOME: cliHome },
});

if (status.status !== 0) {
  process.stderr.write(status.stderr || status.stdout || "Local Supabase is not running.\n");
  process.exit(status.status ?? 1);
}

const local = {};
for (const line of status.stdout.split(/\r?\n/)) {
  const match = /^([A-Z][A-Z0-9_]*)="(.*)"$/.exec(line.trim());
  if (match) local[match[1]] = match[2];
}

if (!local.API_URL || !local.ANON_KEY || !local.SERVICE_ROLE_KEY) {
  process.stderr.write("Could not read local Supabase API credentials.\n");
  process.exit(1);
}

const child = spawn(command, args, {
  cwd: process.cwd(),
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3100",
    NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
    PUBLIC_TOKEN_PEPPER:
      process.env.PUBLIC_TOKEN_PEPPER ?? "renoly-local-public-token-pepper-2026-only",
    AUTH_SECRET: process.env.AUTH_SECRET ?? "renoly-local-auth-secret-2026-not-production",
    // M6 LINE credential envelope key (base64 of 32 bytes) — local/dev only, never a
    // production key. Required by the connect route + webhook/worker decrypt seams.
    LINE_CREDENTIAL_MASTER_KEY_V1:
      process.env.LINE_CREDENTIAL_MASTER_KEY_V1 ??
      Buffer.from("renoly-local-line-master-key-32!").toString("base64"),
    // M6 internal worker shared secret — local/dev only.
    WORKER_SECRET:
      process.env.WORKER_SECRET ?? "renoly-local-worker-secret-2026-not-production",
    PLAYWRIGHT_BASE_URL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100",
    LOCAL_MAIL_URL: local.MAILPIT_URL ?? local.INBUCKET_URL ?? "http://127.0.0.1:55324",
    // pilot-live-intake.spec.ts reads PILOT_MAIL_SERVER_URL to locate the local
    // mailbox; export it explicitly so the E2E magic-link poll targets the same
    // Mailpit/Inbucket instance instead of relying on the hardcoded fallback.
    PILOT_MAIL_SERVER_URL:
      process.env.PILOT_MAIL_SERVER_URL ??
      local.MAILPIT_URL ??
      local.INBUCKET_URL ??
      "http://127.0.0.1:55324",
  },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
