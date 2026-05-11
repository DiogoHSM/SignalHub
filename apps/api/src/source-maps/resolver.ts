import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import type { ParsedStackFrame } from "./parser.js";
import { parseSourceMapJson } from "./parser.js";

export type ResolvedStackFrame = {
  frameIndex: number;
  minifiedFile: string;
  minifiedLine: number;
  minifiedColumn: number;
  originalSource: string;
  originalLine: number;
  originalColumn: number;
  originalName: string | null;
};

export function resolveFrameWithSourceMap(
  sourceMapContent: string,
  frame: ParsedStackFrame
): ResolvedStackFrame | undefined {
  const map = parseSourceMapJson(sourceMapContent);
  const traced = originalPositionFor(new TraceMap(map), {
    line: frame.minifiedLine,
    column: Math.max(0, frame.minifiedColumn - 1)
  });

  if (!traced.source || traced.line === null || traced.column === null) {
    return undefined;
  }

  return {
    frameIndex: frame.frameIndex,
    minifiedFile: frame.minifiedFile,
    minifiedLine: frame.minifiedLine,
    minifiedColumn: frame.minifiedColumn,
    originalSource: traced.source,
    originalLine: traced.line,
    originalColumn: traced.column,
    originalName: traced.name ?? frame.functionName
  };
}
