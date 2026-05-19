import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const oldIdentifierPatterns = [
  { label: "SignalHub", regex: /\bSignalHub\b/g },
  { label: "Signal Hub", regex: /\bSignal Hub\b/g },
  { label: "signal-hub", regex: /\bsignal-hub\b/g },
  { label: "signalhub", regex: /\bsignalhub\b/g },
  { label: "SIGNALHUB", regex: /SIGNALHUB/g },
];

const activeFileExtensions = new Set([
  ".cjs",
  ".css",
  ".env",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".md",
  ".mjs",
  ".sh",
  ".ts",
  ".tsx",
  ".txt",
  ".yml",
  ".yaml",
]);

const activeExtensionlessFiles = new Set([
  "Dockerfile",
  ".env.example",
  "README.md",
  "CLAUDE.md",
]);

function trackedFiles() {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function extensionOf(path: string) {
  const basename = path.split("/").at(-1) ?? path;
  const dotIndex = basename.lastIndexOf(".");

  return dotIndex === -1 ? "" : basename.slice(dotIndex);
}

function isHistoricalOrExternal(path: string) {
  return (
    path.startsWith("docs/superpowers/specs/") ||
    path.startsWith("docs/superpowers/plans/") ||
    path.startsWith("docs/superpowers/runs/") ||
    path.startsWith("review/") ||
    path === "audit.md"
  );
}

function isActiveTextFile(path: string) {
  if (path === "scripts/branding-contract.test.ts") {
    return false;
  }

  if (isHistoricalOrExternal(path)) {
    return false;
  }

  if (activeExtensionlessFiles.has(path)) {
    return true;
  }

  return activeFileExtensions.has(extensionOf(path));
}

function stripAllowedOldNameMentions(content: string) {
  return content
    .replaceAll(
      "formerly developed as SignalHub",
      "formerly developed as OLD_PRODUCT_NAME",
    )
    .replaceAll("formerly SignalHub", "formerly OLD_PRODUCT_NAME");
}

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("SignalMonitor branding contract", () => {
  it("keeps old SignalHub identifiers out of active tracked files", () => {
    const failures: string[] = [];

    for (const path of trackedFiles().filter(isActiveTextFile)) {
      const content = stripAllowedOldNameMentions(read(path));

      for (const { label, regex } of oldIdentifierPatterns) {
        regex.lastIndex = 0;

        if (regex.test(content)) {
          failures.push(`${path} still contains ${label}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("uses the new public product identity in active operator docs", () => {
    expect(read("README.md")).toContain("# SignalMonitor");
    expect(read("README.md")).toContain("sigmon.app");
    expect(read("README.md")).toContain("my.sigmon.app");
    expect(read("CLAUDE.md")).toContain("SignalMonitor Project Context");
    expect(read(".claude/docs/PROJECT-SUMMARY.md")).toContain("SignalMonitor");
  });

  it("uses the new technical identifiers in runtime config", () => {
    expect(read("package.json")).toContain('"name": "sigmon"');
    expect(read("packages/sdk/package.json")).toContain('"name": "@sigmon/sdk"');
    expect(read("tsconfig.base.json")).toContain('"@sigmon/sdk"');
    expect(read(".env.example")).toContain("SIGMON_PUBLIC_ENDPOINT=");
    expect(read("docker-compose.yml")).toContain("SIGMON_ENV_FILE");
    expect(read("docker-compose.yml")).toContain("/var/lib/sigmon/source-maps");
  });

  it("uses the new smoke project names in local and CI smoke gates", () => {
    expect(read("scripts/smoke-compose/args.ts")).toContain("sigmon_smoke");
    expect(read("scripts/smoke-compose/args.ts")).toContain(
      "SIGMON_SMOKE_PROJECT_NAME",
    );
    expect(read(".github/workflows/ci.yml")).toContain("sigmon_ci_smoke");
    expect(read("scripts/ci-workflow.test.ts")).toContain("sigmon_ci_smoke");
  });
});
