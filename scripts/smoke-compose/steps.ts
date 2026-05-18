import type { SmokeSummaryContext, StepResult, StepStatus } from "./types.js";

export interface StepRecorder {
  pass(name: string, detail?: string): void;
  warn(name: string, detail?: string): void;
  fail(name: string, detail?: string): void;
  results(): StepResult[];
}

export function createStepRecorder(write: (line: string) => void): StepRecorder {
  const stepResults: StepResult[] = [];

  const record = (status: StepStatus, name: string, detail?: string) => {
    const result = detail ? { status, name, detail } : { status, name };
    stepResults.push(result);
    write(formatStep(result));
  };

  return {
    pass(name, detail) {
      record("pass", name, detail);
    },
    warn(name, detail) {
      record("warn", name, detail);
    },
    fail(name, detail) {
      record("fail", name, detail);
    },
    results() {
      return [...stepResults];
    }
  };
}

export function renderSummary(context: SmokeSummaryContext, results: StepResult[]): string {
  return [
    "Smoke summary",
    `- Commit: ${context.commit}`,
    `- Compose project: ${context.projectName}`,
    `- API URL: ${context.apiUrl}`,
    `- Passed: ${countStatus(results, "pass")}`,
    `- Warnings: ${countStatus(results, "warn")}`,
    `- Failed: ${countStatus(results, "fail")}`
  ].join("\n");
}

function formatStep(result: StepResult): string {
  const prefix = `[${result.status.toUpperCase()}] ${result.name}`;
  return result.detail ? `${prefix} - ${result.detail}` : prefix;
}

function countStatus(results: StepResult[], status: StepStatus): number {
  return results.filter((result) => result.status === status).length;
}
