import { unzipSync } from "fflate";
import path from "node:path";

export type ParsedStackFrame = {
  frameIndex: number;
  functionName: string | null;
  minifiedFile: string;
  minifiedLine: number;
  minifiedColumn: number;
};

export type SourceMapJson = {
  version: 3;
  file?: string;
  sources: string[];
  names: string[];
  mappings: string;
  sourcesContent?: string[];
  sections?: unknown;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function parseSourceMapJson(content: string): SourceMapJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("invalid_source_map");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("invalid_source_map");
  }

  const map = parsed as Partial<SourceMapJson>;
  if (map.sections !== undefined) {
    throw new Error("indexed_source_maps_unsupported");
  }
  if (
    map.version !== 3 ||
    typeof map.mappings !== "string" ||
    !isStringArray(map.sources) ||
    !isStringArray(map.names) ||
    (map.file !== undefined && typeof map.file !== "string") ||
    (map.sourcesContent !== undefined && !isStringArray(map.sourcesContent))
  ) {
    throw new Error("invalid_source_map");
  }

  return map as SourceMapJson;
}

export function normalizeMinifiedFile(value: string): string {
  try {
    const url = new URL(value);
    return path.posix.basename(url.pathname);
  } catch {
    return path.posix.basename(value.replace(/\\/g, "/"));
  }
}

export function inferMinifiedFileFromMap(map: SourceMapJson): string | undefined {
  return map.file ? normalizeMinifiedFile(map.file) : undefined;
}

export function extractSourceMapsFromZip(content: Buffer): Array<{
  originalFilename: string;
  content: Buffer;
  minifiedFile: string;
}> {
  const entries = unzipSync(new Uint8Array(content));
  const sourceMapEntries = Object.entries(entries).filter(([entryName]) => entryName.endsWith(".map"));

  if (sourceMapEntries.length === 0) {
    throw new Error("source_map_zip_empty");
  }
  if (sourceMapEntries.length > 100) {
    throw new Error("source_map_zip_too_many_entries");
  }

  return sourceMapEntries.map(([entryName, entryContent]) => {
    const buffer = Buffer.from(entryContent);
    const map = parseSourceMapJson(buffer.toString("utf8"));
    const minifiedFile = inferMinifiedFileFromMap(map);
    if (!minifiedFile) {
      throw new Error("source_map_file_missing");
    }

    return {
      originalFilename: normalizeMinifiedFile(entryName),
      content: buffer,
      minifiedFile
    };
  });
}

export function parseStackFrames(stack: string): ParsedStackFrame[] {
  const frames: ParsedStackFrame[] = [];

  for (const line of stack.split(/\r?\n/)) {
    const frame = parseChromeStackLine(line) ?? parseFirefoxStackLine(line);
    if (!frame) {
      continue;
    }

    frames.push({
      frameIndex: frames.length,
      ...frame
    });
  }

  return frames;
}

function parseChromeStackLine(
  line: string
): Omit<ParsedStackFrame, "frameIndex"> | undefined {
  const withFunction = line.match(/^\s*at\s+(.+?)\s+\((.+):(\d+):(\d+)\)\s*$/);
  const anonymous = line.match(/^\s*at\s+(.+):(\d+):(\d+)\s*$/);
  const match = withFunction ?? anonymous;
  if (!match) {
    return undefined;
  }

  if (withFunction) {
    return stackFrameFromMatch(match[2], match[3], match[4], match[1]);
  }

  return stackFrameFromMatch(match[1], match[2], match[3], null);
}

function parseFirefoxStackLine(
  line: string
): Omit<ParsedStackFrame, "frameIndex"> | undefined {
  const match = line.match(/^\s*(.*?)@(.+):(\d+):(\d+)\s*$/);
  if (!match) {
    return undefined;
  }

  return stackFrameFromMatch(match[2], match[3], match[4], match[1] || null);
}

function stackFrameFromMatch(
  file: string,
  line: string,
  column: string,
  functionName: string | null
): Omit<ParsedStackFrame, "frameIndex"> {
  return {
    functionName: functionName?.trim() || null,
    minifiedFile: normalizeMinifiedFile(file),
    minifiedLine: Number(line),
    minifiedColumn: Number(column)
  };
}
