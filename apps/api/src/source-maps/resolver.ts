import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import type { ParsedStackFrame } from "./parser.js";
import { parseSourceMapJson, parseStackFrames } from "./parser.js";

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

export type ResolveErrorStackInput = { errorId: string; projectId: string; environmentId: string };

export type SourceMapResolutionStatus = "resolved" | "partially_resolved" | "unresolved" | "unavailable";

export type SourceMapResolutionResponse = {
  errorId: string;
  release: string | null;
  status: SourceMapResolutionStatus;
  frames: Array<ResolvedStackFrame & { sourceMapArtifactId: string }>;
  unresolvedFrameCount: number;
};

type ErrorForSourceMapResolution = {
  id: string;
  projectId: string;
  environmentId: string;
  release: string | null;
  stack: string | null;
};

type CachedStackFrame = ResolvedStackFrame & {
  sourceMapArtifactId: string;
};

export type ResolveErrorStackDependencies = {
  getErrorForSourceMapResolution: (input: ResolveErrorStackInput) => Promise<ErrorForSourceMapResolution | null>;
  getCachedErrorStackResolution: (errorId: string) => Promise<CachedStackFrame[]>;
  findSourceMapArtifactForFrame: (input: {
    projectId: string;
    environmentId: string;
    release: string;
    minifiedFile: string;
  }) => Promise<{ id: string; storagePath: string } | null>;
  readSourceMapFile: (input: { storagePath: string }) => Promise<string>;
  replaceErrorStackResolutions: (input: {
    errorId: string;
    projectId: string;
    environmentId: string;
    release: string;
    frames: CachedStackFrame[];
  }) => Promise<CachedStackFrame[]>;
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

function unresolvedResponse(error: ErrorForSourceMapResolution): SourceMapResolutionResponse {
  return {
    errorId: error.id,
    release: error.release,
    status: "unresolved",
    frames: [],
    unresolvedFrameCount: 0
  };
}

function resolutionStatus(resolvedCount: number, totalCount: number): SourceMapResolutionStatus {
  if (resolvedCount === 0) {
    return "unresolved";
  }

  return resolvedCount === totalCount ? "resolved" : "partially_resolved";
}

function toResponseFrame(frame: CachedStackFrame): CachedStackFrame {
  return {
    sourceMapArtifactId: frame.sourceMapArtifactId,
    frameIndex: frame.frameIndex,
    minifiedFile: frame.minifiedFile,
    minifiedLine: frame.minifiedLine,
    minifiedColumn: frame.minifiedColumn,
    originalSource: frame.originalSource,
    originalLine: frame.originalLine,
    originalColumn: frame.originalColumn,
    originalName: frame.originalName
  };
}

export async function resolveErrorStackWithSourceMaps(
  input: ResolveErrorStackInput & ResolveErrorStackDependencies
): Promise<SourceMapResolutionResponse | null> {
  const error = await input.getErrorForSourceMapResolution({
    errorId: input.errorId,
    projectId: input.projectId,
    environmentId: input.environmentId
  });
  if (!error) {
    return null;
  }

  if (!error.release || !error.stack) {
    return unresolvedResponse(error);
  }

  const cachedFrames = await input.getCachedErrorStackResolution(error.id);
  if (cachedFrames.length > 0) {
    return {
      errorId: error.id,
      release: error.release,
      status: "resolved",
      frames: cachedFrames.map(toResponseFrame),
      unresolvedFrameCount: 0
    };
  }

  const parsedFrames = parseStackFrames(error.stack);
  if (parsedFrames.length === 0) {
    return unresolvedResponse(error);
  }

  const resolvedFrames: CachedStackFrame[] = [];
  for (const frame of parsedFrames) {
    const artifact = await input.findSourceMapArtifactForFrame({
      projectId: error.projectId,
      environmentId: error.environmentId,
      release: error.release,
      minifiedFile: frame.minifiedFile
    });
    if (!artifact) {
      continue;
    }

    try {
      const sourceMapContent = await input.readSourceMapFile({ storagePath: artifact.storagePath });
      const resolved = resolveFrameWithSourceMap(sourceMapContent, frame);
      if (resolved) {
        resolvedFrames.push({ ...resolved, sourceMapArtifactId: artifact.id });
      }
    } catch {
      continue;
    }
  }

  const fullyResolved = resolvedFrames.length === parsedFrames.length;
  const frames =
    fullyResolved && resolvedFrames.length > 0
      ? (
          await input.replaceErrorStackResolutions({
            errorId: error.id,
            projectId: error.projectId,
            environmentId: error.environmentId,
            release: error.release,
            frames: resolvedFrames
          })
        ).map(toResponseFrame)
      : resolvedFrames.map(toResponseFrame);

  return {
    errorId: error.id,
    release: error.release,
    status: resolutionStatus(frames.length, parsedFrames.length),
    frames,
    unresolvedFrameCount: parsedFrames.length - frames.length
  };
}
