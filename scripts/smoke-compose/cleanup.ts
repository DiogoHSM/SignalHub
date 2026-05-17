export type CleanupPlanInput = { preserve: boolean; projectName: string; tempDir: string };
export type CleanupPlan = { preserve: boolean; commands: string[][]; removeTempDir: boolean; message: string };

export function cleanupPlan(input: CleanupPlanInput): CleanupPlan {
  if (input.preserve) {
    return {
      preserve: true,
      commands: [],
      removeTempDir: false,
      message: `Preserved Compose project ${input.projectName} and temp directory ${input.tempDir}. Inspect logs with docker compose -p ${input.projectName} logs.`
    };
  }

  return {
    preserve: false,
    commands: [["docker", "compose", "-p", input.projectName, "down", "-v"]],
    removeTempDir: true,
    message: `Cleanup will remove Compose resources and ${input.tempDir}`
  };
}
