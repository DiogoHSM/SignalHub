import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { CommandInput } from "./types.js";

const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");
const doctorEntry = fileURLToPath(new URL("../doctor.ts", import.meta.url));

export function doctorCommand(
  args: string[],
  options: Omit<CommandInput, "command" | "args"> = {}
): CommandInput {
  return {
    command: process.execPath,
    args: [tsxCli, doctorEntry, ...args],
    ...options
  };
}
