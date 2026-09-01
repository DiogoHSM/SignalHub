import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const smokeDir = mkdtempSync(join(tmpdir(), "sigmon-sdk-packed-consumer-"));

function run(args, cwd) {
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const commandArgs = process.platform === "win32"
    ? ["/d", "/c", "npm", ...args]
    : args;
  return execFileSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

try {
  const packOutput = JSON.parse(run(["pack", "--json", "--pack-destination", smokeDir], packageDir));
  const tarball = join(smokeDir, packOutput[0].filename);
  const consumerDir = join(smokeDir, "consumer");
  mkdirSync(consumerDir, { recursive: true });
  writeFileSync(
    join(consumerDir, "package.json"),
    JSON.stringify({ name: "sigmon-sdk-packed-consumer", private: true, type: "module" }),
  );

  run(["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", tarball], consumerDir);

  const manifest = JSON.parse(readFileSync(join(consumerDir, "node_modules", "@sigmon", "sdk", "package.json"), "utf8"));
  if (manifest.dependencies?.["@sigmon/telemetry"]) {
    throw new Error("packed SDK retains a runtime dependency on private @sigmon/telemetry");
  }

  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { createFeedbackSignal, createSignalMonitorClient } from "@sigmon/sdk";
       const signal = createFeedbackSignal({
         message: "packed consumer",
         pageUrl: "https://app.test/reset?token=secret#fragment"
       });
       if (signal.payload.page_url !== "https://app.test/reset?token=%5BREDACTED%5D") {
         throw new Error("packed SDK did not execute authoritative URL sanitization");
       }
       const client = createSignalMonitorClient({
         endpoint: "https://ingest.test",
         apiKey: "sh_test_packed",
         fetch: async () => new Response(null, { status: 202 })
       });
       if (typeof client.feedback !== "function") throw new Error("normal SDK client path did not load");`,
    ],
    { cwd: consumerDir, stdio: "inherit" },
  );

  console.log("packed SDK clean-consumer smoke passed");
} finally {
  if (process.env.SIGMON_KEEP_PACKED_SMOKE !== "1") {
    rmSync(smokeDir, { recursive: true, force: true });
  } else {
    console.log(`packed SDK smoke directory retained at ${smokeDir}`);
  }
}
