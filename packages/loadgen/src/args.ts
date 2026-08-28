export function parseDurationMs(value: string): number {
  const match = /^(\d+)(m|h|d)$/.exec(value.trim());
  if (!match) {
    throw new Error(`invalid duration "${value}" — expected a number followed by m, h, or d (e.g. "30m", "2h", "7d")`);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const unitMs = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return amount * unitMs;
}

export type RunArgs = {
  config: string;
  profile: string;
  projects: number;
  backfillMs: number;
  liveMs: number;
};

export function parseRunArgs(argv: string[]): RunArgs {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      flags.set(token.slice(2), argv[i + 1]);
      i += 1;
    }
  }

  const profile = flags.get("profile");
  if (!profile) {
    throw new Error("--profile is required");
  }

  const projectsRaw = flags.get("projects");
  const projects = projectsRaw ? Number(projectsRaw) : 1;
  if (!Number.isInteger(projects) || projects < 1) {
    throw new Error("--projects must be a positive integer");
  }

  const backfillRaw = flags.get("backfill");
  const liveRaw = flags.get("live");
  if (!backfillRaw && !liveRaw) {
    throw new Error("at least one of --backfill or --live is required");
  }

  return {
    config: flags.get("config") ?? ".loadgen.json",
    profile,
    projects,
    backfillMs: backfillRaw ? parseDurationMs(backfillRaw) : 0,
    liveMs: liveRaw ? parseDurationMs(liveRaw) : 0
  };
}
