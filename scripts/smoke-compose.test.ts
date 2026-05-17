import { describe, expect, it } from "vitest";
import { parseSmokeArgs } from "./smoke-compose/args.js";
import { createRedactor } from "./smoke-compose/redaction.js";
import { createStepRecorder, renderSummary } from "./smoke-compose/steps.js";

describe("smoke compose primitives", () => {
  it("uses default smoke options", () => {
    expect(parseSmokeArgs([], {})).toEqual({
      projectName: "signalhub_smoke",
      apiUrl: "http://localhost:3000",
      preserve: false
    });
  });

  it("prefers flags over environment defaults", () => {
    expect(
      parseSmokeArgs(["--project-name", "signalhub_custom", "--api-url", "http://127.0.0.1:3300", "--preserve"], {
        SIGNALHUB_SMOKE_PROJECT_NAME: "signalhub_env",
        SIGNALHUB_SMOKE_API_URL: "http://localhost:4400"
      })
    ).toEqual({
      projectName: "signalhub_custom",
      apiUrl: "http://127.0.0.1:3300",
      preserve: true
    });
  });

  it("rejects incomplete and unknown arguments", () => {
    expect(() => parseSmokeArgs(["--project-name"], {})).toThrow("Missing value for --project-name");
    expect(() => parseSmokeArgs(["--project-name", "--api-url"], {})).toThrow("Missing value for --project-name");
    expect(() => parseSmokeArgs(["--api-url"], {})).toThrow("Missing value for --api-url");
    expect(() => parseSmokeArgs(["--api-url", "--preserve"], {})).toThrow("Missing value for --api-url");
    expect(() => parseSmokeArgs(["--mystery"], {})).toThrow("Unknown smoke argument: --mystery");
  });

  it("redacts registered secrets and credential URLs", () => {
    const redactor = createRedactor(["admin-password", "sh_secret", "cookie-value"]);
    const output = redactor.redact(
      "admin-password sh_secret cookie-value http://user:pass@localhost:3000/path https://token:secret@example.com/path"
    );

    expect(output).toBe(
      "[REDACTED] [REDACTED] [REDACTED] http://[REDACTED]@localhost:3000/path https://[REDACTED]@example.com/path"
    );
  });

  it("redacts secrets registered after creation", () => {
    const redactor = createRedactor([]);

    redactor.add("late-secret");

    expect(redactor.redact("late-secret")).toBe("[REDACTED]");
  });

  it("records steps and renders summary counts", () => {
    const lines: string[] = [];
    const recorder = createStepRecorder((line) => lines.push(line));

    recorder.pass("doctor", "local checks passed");
    recorder.warn("native bindings", "optional build noise");
    recorder.fail("ready", "API readiness failed");

    expect(lines).toEqual([
      "[PASS] doctor - local checks passed",
      "[WARN] native bindings - optional build noise",
      "[FAIL] ready - API readiness failed"
    ]);
    expect(
      renderSummary({ commit: "abc1234", projectName: "signalhub_smoke", apiUrl: "http://localhost:3000" }, recorder.results())
    ).toBe([
      "Smoke summary",
      "- Commit: abc1234",
      "- Compose project: signalhub_smoke",
      "- API URL: http://localhost:3000",
      "- Passed: 1",
      "- Warnings: 1",
      "- Failed: 1"
    ].join("\n"));
  });
});
