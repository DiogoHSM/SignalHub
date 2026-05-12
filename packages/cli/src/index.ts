#!/usr/bin/env node
import { runSourceMapUploadCommand } from "./source-maps.js";

const [group, command, ...args] = process.argv.slice(2);

if (group === "sourcemaps" && command === "upload") {
  const exitCode = await runSourceMapUploadCommand(args, {
    env: process.env,
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line)
  });
  process.exitCode = exitCode;
} else {
  console.error("Usage: signalhub sourcemaps upload [options]");
  process.exitCode = 1;
}
