# S8 · Console v2 Alerts screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the v2 "Alerts" screen into `apps/console`, wired to the existing alerts backend (rules, events, channels), and flip the console registry `alerts` entry from legacy `AlertsPanel` to the new v2 `AlertsScreen`.

**Architecture:** Flat section screen `AlertsScreen({ ctx })` (no shell drill). A race-guarded `useAlerts` hook fetches three sources in parallel and delegates to a pure, unit-tested `buildAlertsVM(input, nowMs)`. Registry flip only; legacy `AlertsPanel` stays in `ConsoleShell.tsx` (untouched) so product capability is preserved.

**Tech Stack:** React 19 + Vite + Vitest (jsdom), TypeScript, existing `apps/console/src/components/ui/v2` primitives & CSS.

## Global Constraints

- **English UI copy** even though the design source is pt-BR (CLAUDE.md).
- Every **new console DOM test file** (`*.test.ts`/`*.test.tsx` that calls `render`/`renderHook`) MUST carry `// @vitest-environment jsdom` as **line 1** — repo-root `pnpm test` runs vitest in node by default; the pragma is required or DOM tests fail.
- **Never rename design copy to dodge a Testing Library duplicate-text collision.** Pre-disambiguate with `getAllByText(...).length >= 1`, exact full-string `getByText`, or `within(card)`.
- Mutations are **`pushToast` stubs** only; introduce **no write path**. Real CRUD remains in legacy `AlertsPanel` (do not touch `AlertsPanel.tsx` or `ConsoleShell.tsx`).
- **AI Suggestions card is OMITTED** (depends on unbuilt backend B4/PER-347).
- Severity DOM text is lowercase (`critical`/`warning`/`info`); the design uppercases via CSS `text-transform` only — assert lowercase in tests.
- No new backend, no secret values surfaced, no source content.

---

### Task 1: `useAlerts` hook + pure `buildAlertsVM`

**Files:**
- Create: `apps/console/src/v2/screens/useAlerts.ts`
- Test: `apps/console/src/v2/screens/useAlerts.test.ts`

**Interfaces:**
- Consumes: `ApiClient["listAlertRules" | "listAlertEvents" | "listNotificationChannels"]`; response types `AlertRuleResponse`, `AlertEventResponse`, `NotificationChannelResponse`, `AlertSeverity` from `../../api/types`.
- Produces: `buildAlertsVM(input: AlertsInput, nowMs: number): AlertsVM`; `useAlerts(args): UseAlertsResult`; exported VM types `AlertsVM`, `AlertRuleRowVM`, `ChannelRowVM`, `TimelineDayVM`, `TimelineFireVM`, `AlertsHeaderVM`, `SeverityTag`, `AlertsInput`, `UseAlertsResult`.

- [ ] **Step 1: Write the failing test** — `apps/console/src/v2/screens/useAlerts.test.ts`

```tsx
// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  AlertEventResponse,
  AlertRuleResponse,
  NotificationChannelResponse,
} from "../../api/types";
import { buildAlertsVM, useAlerts } from "./useAlerts";

const NOW = Date.UTC(2026, 5, 23, 12, 0, 0); // 2026-06-23T12:00:00Z (Tue)

function rule(over: Partial<AlertRuleResponse> = {}): AlertRuleResponse {
  return {
    id: "r1",
    projectId: "p",
    environmentId: "e",
    notificationChannelId: null,
    name: "Critical errors in production",
    type: "critical_errors",
    severity: "critical",
    windowMinutes: 5,
    threshold: "1",
    cooldownMinutes: 10,
    routePattern: null,
    minimumSampleSize: 0,
    enabled: true,
    lastEvaluatedAt: null,
    lastTriggeredAt: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    archivedAt: null,
    ...over,
  };
}

function event(over: Partial<AlertEventResponse> = {}): AlertEventResponse {
  return {
    id: "e1",
    ruleId: "r1",
    monitorId: null,
    projectId: "p",
    environmentId: "e",
    status: "triggered",
    severity: "critical",
    triggeredAt: "2026-06-23T09:00:00.000Z",
    windowStart: "2026-06-23T08:55:00.000Z",
    windowEnd: "2026-06-23T09:00:00.000Z",
    observedValue: "3",
    threshold: "1",
    message: "fired",
    metadata: null,
    createdAt: "2026-06-23T09:00:00.000Z",
    latestDeliveryStatus: "success",
    ...over,
  };
}

const webhookChannel: NotificationChannelResponse = {
  id: "c1",
  name: "Slack · #incidents",
  type: "webhook",
  url: "https://hooks.slack.com/services/T0/abc",
  emailRecipients: [],
  secretHeaderName: null,
  hasSecret: false,
  enabled: true,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  archivedAt: null,
};

const emailChannel: NotificationChannelResponse = {
  id: "c2",
  name: "Email · finance",
  type: "email",
  url: null,
  emailRecipients: ["finance@acme.dev", "cfo@acme.dev"],
  secretHeaderName: null,
  hasSecret: false,
  enabled: false,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  archivedAt: null,
};

describe("buildAlertsVM", () => {
  it("maps a rule row with severity tag, subLabel, resolved channel, fires7d", () => {
    const vm = buildAlertsVM(
      {
        rules: [rule({ notificationChannelId: "c1" })],
        events: [event(), event({ id: "e2" })],
        channels: [webhookChannel],
      },
      NOW,
    );
    expect(vm.rules).toHaveLength(1);
    const r = vm.rules[0];
    expect(r.name).toBe("Critical errors in production");
    expect(r.subLabel).toBe("critical_errors · 1 · 5m");
    expect(r.severity).toBe("critical");
    expect(r.severityTag).toBe("critical");
    expect(r.enabled).toBe(true);
    expect(r.channelLabel).toBe("Slack · #incidents");
    expect(r.fires7d).toBe(2);
  });

  it("falls back to Unassigned channel and maps warn/'' severity tags", () => {
    const vm = buildAlertsVM(
      {
        rules: [
          rule({ id: "r2", severity: "warning", notificationChannelId: "missing" }),
          rule({ id: "r3", severity: "info", notificationChannelId: null }),
        ],
        events: [],
        channels: [],
      },
      NOW,
    );
    expect(vm.rules[0].severityTag).toBe("warn");
    expect(vm.rules[0].channelLabel).toBe("Unassigned");
    expect(vm.rules[1].severityTag).toBe("");
    expect(vm.rules[1].channelLabel).toBe("Unassigned");
  });

  it("counts header active rules (enabled, non-archived) and 7d fires", () => {
    const vm = buildAlertsVM(
      {
        rules: [
          rule({ id: "r1", enabled: true }),
          rule({ id: "r2", enabled: false }),
          rule({ id: "r3", enabled: true, archivedAt: "2026-06-10T00:00:00.000Z" }),
        ],
        events: [event(), event({ id: "e2", triggeredAt: "2026-06-20T00:00:00.000Z" })],
        channels: [],
      },
      NOW,
    );
    expect(vm.header.activeRuleCount).toBe(1);
    expect(vm.header.fires7d).toBe(2);
  });

  it("maps channel rows by type with target and ok flag", () => {
    const vm = buildAlertsVM(
      { rules: [], events: [], channels: [webhookChannel, emailChannel] },
      NOW,
    );
    expect(vm.channels[0]).toMatchObject({
      icon: "webhook",
      target: "https://hooks.slack.com/services/T0/abc",
      ok: true,
    });
    expect(vm.channels[1]).toMatchObject({
      icon: "mail",
      target: "finance@acme.dev, cfo@acme.dev",
      ok: false,
    });
  });

  it("buckets the timeline into 7 UTC days ending today, by hour and tone", () => {
    const vm = buildAlertsVM(
      {
        rules: [],
        channels: [],
        events: [
          event({ id: "today", triggeredAt: "2026-06-23T06:00:00.000Z", severity: "critical" }),
          event({ id: "sixago", triggeredAt: "2026-06-17T12:00:00.000Z", severity: "warning" }),
          event({ id: "old", triggeredAt: "2026-06-15T12:00:00.000Z" }),
        ],
      },
      NOW,
    );
    expect(vm.timeline).toHaveLength(7);
    expect(vm.timeline[6].label).toBe("Tue 23");
    expect(vm.timeline[6].fires).toHaveLength(1);
    expect(vm.timeline[6].fires[0].hourFraction).toBeCloseTo(0.25, 5);
    expect(vm.timeline[6].fires[0].tone).toBe("critical");
    expect(vm.timeline[0].fires).toHaveLength(1);
    expect(vm.timeline[0].fires[0].tone).toBe("warn");
    const totalFires = vm.timeline.reduce((n, d) => n + d.fires.length, 0);
    expect(totalFires).toBe(2); // 8-days-ago event excluded
  });

  it("skips events with invalid timestamps", () => {
    const vm = buildAlertsVM(
      { rules: [], channels: [], events: [event({ triggeredAt: "not-a-date" })] },
      NOW,
    );
    expect(vm.header.fires7d).toBe(0);
    expect(vm.timeline.every((d) => d.fires.length === 0)).toBe(true);
  });
});

describe("useAlerts", () => {
  function makeClient() {
    return {
      listAlertRules: vi.fn().mockResolvedValue({ rules: [rule()] }),
      listAlertEvents: vi.fn().mockResolvedValue({ data: [event()] }),
      listNotificationChannels: vi.fn().mockResolvedValue({ channels: [webhookChannel] }),
    };
  }

  it("loads and builds a VM", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useAlerts({ client, projectId: "p", environmentId: "e" }),
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data?.rules).toHaveLength(1);
    expect(result.current.data?.channels).toHaveLength(1);
    expect(client.listAlertEvents).toHaveBeenCalledWith({
      projectId: "p",
      environmentId: "e",
      limit: 100,
    });
  });

  it("no-ops without project/environment", () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useAlerts({ client, projectId: undefined, environmentId: undefined }),
    );
    expect(result.current.status).toBe("loading");
    expect(client.listAlertRules).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sigmon/console test -- useAlerts`
Expected: FAIL — `buildAlertsVM`/`useAlerts` not exported / module missing.

- [ ] **Step 3: Write the implementation** — `apps/console/src/v2/screens/useAlerts.ts`

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type {
  AlertEventResponse,
  AlertRuleResponse,
  AlertSeverity,
  NotificationChannelResponse,
} from "../../api/types";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type SeverityTag = "critical" | "warn" | "";

export type AlertRuleRowVM = {
  id: string;
  name: string;
  subLabel: string;
  severity: AlertSeverity;
  severityTag: SeverityTag;
  enabled: boolean;
  channelLabel: string;
  fires7d: number;
};

export type ChannelRowVM = {
  id: string;
  name: string;
  icon: "webhook" | "mail";
  target: string;
  ok: boolean;
};

export type TimelineFireVM = { hourFraction: number; tone: "critical" | "warn" };
export type TimelineDayVM = { label: string; fires: TimelineFireVM[] };

export type AlertsHeaderVM = { activeRuleCount: number; fires7d: number };

export type AlertsVM = {
  header: AlertsHeaderVM;
  rules: AlertRuleRowVM[];
  channels: ChannelRowVM[];
  timeline: TimelineDayVM[];
};

export type AlertsInput = {
  rules: AlertRuleResponse[];
  events: AlertEventResponse[];
  channels: NotificationChannelResponse[];
};

export type UseAlertsResult = {
  data: AlertsVM | null;
  status: "loading" | "ok" | "error";
  reload: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function severityToTag(sev: AlertSeverity): SeverityTag {
  if (sev === "critical") return "critical";
  if (sev === "warning") return "warn";
  return "";
}

function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// ---------------------------------------------------------------------------
// Pure VM builder
// ---------------------------------------------------------------------------

export function buildAlertsVM(input: AlertsInput, nowMs: number): AlertsVM {
  const { rules, events, channels } = input;

  const channelName = new Map<string, string>();
  for (const c of channels) channelName.set(c.id, c.name);

  const sevenDaysAgo = nowMs - 7 * DAY_MS;
  const recentEvents = events.filter((e) => {
    const t = new Date(e.triggeredAt).getTime();
    return Number.isFinite(t) && t >= sevenDaysAgo && t <= nowMs;
  });

  const firesByRule = new Map<string, number>();
  for (const e of recentEvents) {
    if (e.ruleId) firesByRule.set(e.ruleId, (firesByRule.get(e.ruleId) ?? 0) + 1);
  }

  const ruleRows: AlertRuleRowVM[] = rules.map((r) => ({
    id: r.id,
    name: r.name,
    subLabel: `${r.type} · ${r.threshold} · ${r.windowMinutes}m`,
    severity: r.severity,
    severityTag: severityToTag(r.severity),
    enabled: r.enabled,
    channelLabel:
      (r.notificationChannelId && channelName.get(r.notificationChannelId)) || "Unassigned",
    fires7d: firesByRule.get(r.id) ?? 0,
  }));

  const channelRows: ChannelRowVM[] = channels.map((c) => ({
    id: c.id,
    name: c.name,
    icon: c.type === "webhook" ? "webhook" : "mail",
    target: c.type === "webhook" ? c.url : c.emailRecipients.join(", "),
    ok: c.enabled,
  }));

  const startOfToday = startOfUtcDay(nowMs);
  const timeline: TimelineDayVM[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfToday - (6 - i) * DAY_MS);
    timeline.push({ label: `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}`, fires: [] });
  }
  for (const e of recentEvents) {
    const t = new Date(e.triggeredAt).getTime();
    const dayIndex = 6 - Math.floor((startOfToday - startOfUtcDay(t)) / DAY_MS);
    if (dayIndex < 0 || dayIndex > 6) continue;
    const d = new Date(t);
    const hourFraction = (d.getUTCHours() + d.getUTCMinutes() / 60) / 24;
    timeline[dayIndex].fires.push({
      hourFraction,
      tone: e.severity === "critical" ? "critical" : "warn",
    });
  }

  const activeRuleCount = rules.filter((r) => r.enabled && r.archivedAt == null).length;

  return {
    header: { activeRuleCount, fires7d: recentEvents.length },
    rules: ruleRows,
    channels: channelRows,
    timeline,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

type UseAlertsArgs = {
  client: {
    listAlertRules: ApiClient["listAlertRules"];
    listAlertEvents: ApiClient["listAlertEvents"];
    listNotificationChannels: ApiClient["listNotificationChannels"];
  };
  projectId: string | undefined;
  environmentId: string | undefined;
};

export function useAlerts({ client, projectId, environmentId }: UseAlertsArgs): UseAlertsResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [data, setData] = useState<AlertsVM | null>(null);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId || !environmentId) return;

    const gen = ++genRef.current;
    setStatus("loading");

    const rulesFetch = client.listAlertRules({ projectId, environmentId });
    const eventsFetch = client.listAlertEvents({ projectId, environmentId, limit: 100 });
    const channelsFetch = client.listNotificationChannels();

    Promise.all([rulesFetch, eventsFetch, channelsFetch])
      .then(([rulesRes, eventsRes, channelsRes]) => {
        if (gen !== genRef.current) return;
        const vm = buildAlertsVM(
          { rules: rulesRes.rules, events: eventsRes.data, channels: channelsRes.channels },
          Date.now(),
        );
        setData(vm);
        setStatus("ok");
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setData(null);
        setStatus("error");
      });

    return () => {
      ++genRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, environmentId, tick]);

  return { data, status, reload };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sigmon/console test -- useAlerts`
Expected: PASS (all `buildAlertsVM` + `useAlerts` cases green).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @sigmon/console exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/v2/screens/useAlerts.ts apps/console/src/v2/screens/useAlerts.test.ts
git commit -m "feat(console): useAlerts hook + buildAlertsVM for v2 alerts"
```

---

### Task 2: `AlertsScreen` component

**Files:**
- Create: `apps/console/src/v2/screens/AlertsScreen.tsx`
- Test: `apps/console/src/v2/screens/AlertsScreen.test.tsx`

**Interfaces:**
- Consumes: `useAlerts` + VM types from `./useAlerts`; `ScreenCtx` from `./registry`; primitives `EmptyHint, Icon, PageHead, Segmented` from `../../components/ui/v2`.
- Produces: `export function AlertsScreen({ ctx }: { ctx: ScreenCtx })`.

- [ ] **Step 1: Write the failing test** — `apps/console/src/v2/screens/AlertsScreen.test.tsx`

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment, Project } from "../../api/types";
import { AlertsScreen } from "./AlertsScreen";
import type { ScreenCtx } from "./registry";
import * as useAlertsModule from "./useAlerts";
import type { AlertsVM } from "./useAlerts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const project = { id: "p", name: "Demo" } as Project;
const environment = { id: "e", name: "production" } as Environment;

function makeCtx(over: Partial<ScreenCtx> = {}): ScreenCtx {
  return {
    client: {} as never,
    project,
    environment,
    environments: [environment],
    onCreateEnvironment: vi.fn(),
    onArchiveProject: vi.fn(),
    onSecretCreated: vi.fn(),
    onSelectEnvironment: vi.fn(),
    onUpdateProject: vi.fn(),
    navigate: vi.fn(),
    back: vi.fn(),
    drill: vi.fn(),
    pushToast: vi.fn(),
    ...over,
  } as ScreenCtx;
}

const vm: AlertsVM = {
  header: { activeRuleCount: 2, fires7d: 5 },
  rules: [
    {
      id: "r1",
      name: "Critical errors in production",
      subLabel: "critical_errors · 1 · 5m",
      severity: "critical",
      severityTag: "critical",
      enabled: true,
      channelLabel: "Slack · #incidents",
      fires7d: 4,
    },
    {
      id: "r2",
      name: "Worker failures dlq",
      subLabel: "error_count · 5 · 30m",
      severity: "warning",
      severityTag: "warn",
      enabled: false,
      channelLabel: "Discord · #ops",
      fires7d: 0,
    },
  ],
  channels: [
    { id: "c1", name: "Slack · #incidents", icon: "webhook", target: "https://hooks.slack.com/services/T0/abc", ok: true },
    { id: "c2", name: "Email · finance", icon: "mail", target: "finance@acme.dev", ok: false },
  ],
  timeline: [
    { label: "Wed 17", fires: [] },
    { label: "Thu 18", fires: [{ hourFraction: 0.5, tone: "warn" }] },
    { label: "Fri 19", fires: [] },
    { label: "Sat 20", fires: [] },
    { label: "Sun 21", fires: [] },
    { label: "Mon 22", fires: [{ hourFraction: 0.25, tone: "critical" }] },
    { label: "Tue 23", fires: [{ hourFraction: 0.7, tone: "critical" }] },
  ],
};

function mockUseAlerts(data: AlertsVM | null, status: "loading" | "ok" | "error" = "ok") {
  vi.spyOn(useAlertsModule, "useAlerts").mockReturnValue({ data, status, reload: vi.fn() });
}

describe("AlertsScreen", () => {
  it("shows a guard hint when project/env are missing", () => {
    mockUseAlerts(null, "loading");
    render(<AlertsScreen ctx={makeCtx({ project: undefined, environment: undefined })} />);
    expect(screen.getByText(/no project selected/i)).toBeInTheDocument();
  });

  it("shows loading and error states", () => {
    mockUseAlerts(null, "loading");
    const { rerender } = render(<AlertsScreen ctx={makeCtx()} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    mockUseAlerts(null, "error");
    rerender(<AlertsScreen ctx={makeCtx()} />);
    expect(screen.getByText(/could not load/i)).toBeInTheDocument();
  });

  it("renders the page head with active-rule and fires counts", () => {
    mockUseAlerts(vm);
    render(<AlertsScreen ctx={makeCtx()} />);
    expect(screen.getByText("Alerts")).toBeInTheDocument();
    expect(screen.getByText("2 active rules · 5 fires in the last 7 days")).toBeInTheDocument();
    expect(screen.getByText("New rule")).toBeInTheDocument();
    // "Channels" appears in the head action button AND the right-card head
    expect(screen.getAllByText("Channels").length).toBeGreaterThanOrEqual(2);
  });

  it("renders a rule row with severity, state, channel, and 7d count", () => {
    mockUseAlerts(vm);
    render(<AlertsScreen ctx={makeCtx()} />);
    expect(screen.getByText("Critical errors in production")).toBeInTheDocument();
    expect(screen.getByText("critical_errors · 1 · 5m")).toBeInTheDocument();
    // severity DOM text is lowercase (uppercased only via CSS)
    expect(screen.getByText("critical")).toBeInTheDocument();
    expect(screen.getByText("● active")).toBeInTheDocument();
    expect(screen.getByText("paused")).toBeInTheDocument();
  });

  it("filters rules to paused via the Segmented control", async () => {
    mockUseAlerts(vm);
    render(<AlertsScreen ctx={makeCtx()} />);
    expect(screen.getByText("Critical errors in production")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Paused"));
    expect(screen.queryByText("Critical errors in production")).not.toBeInTheDocument();
    expect(screen.getByText("Worker failures dlq")).toBeInTheDocument();
  });

  it("renders channels and fires test / new-rule toasts", async () => {
    mockUseAlerts(vm);
    const ctx = makeCtx();
    render(<AlertsScreen ctx={ctx} />);
    // channel name appears in the rule channel column AND the channel card
    expect(screen.getAllByText("Slack · #incidents").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Email · finance")).toBeInTheDocument();
    await userEvent.click(screen.getAllByText("test")[0]);
    expect(ctx.pushToast).toHaveBeenCalledWith("Test notification sent to Slack · #incidents");
    await userEvent.click(screen.getByText("New rule"));
    expect(ctx.pushToast).toHaveBeenCalledWith("Rule editor is not yet available");
  });

  it("shows an empty hint when there are no rules", () => {
    mockUseAlerts({ ...vm, rules: [] });
    render(<AlertsScreen ctx={makeCtx()} />);
    expect(screen.getByText("No alert rules")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sigmon/console test -- AlertsScreen`
Expected: FAIL — `AlertsScreen` module missing.

- [ ] **Step 3: Write the implementation** — `apps/console/src/v2/screens/AlertsScreen.tsx`

```tsx
import { useState } from "react";
import { EmptyHint, Icon, PageHead, Segmented } from "../../components/ui/v2";
import type { ScreenCtx } from "./registry";
import { useAlerts } from "./useAlerts";
import type { AlertRuleRowVM, ChannelRowVM, TimelineDayVM } from "./useAlerts";

const RULE_GRID = "1.5fr 96px 90px 1fr 70px 84px";
const FILTERS = ["All", "Active", "Paused"] as const;
type RuleFilter = (typeof FILTERS)[number];

function FiresTimeline({ timeline }: { timeline: TimelineDayVM[] }) {
  const total = timeline.reduce((n, d) => n + d.fires.length, 0);
  if (total === 0) {
    return (
      <p className="sh-faint" style={{ fontSize: 12, margin: 0 }}>
        No fires in the last 7 days
      </p>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
      {timeline.map((day) => (
        <div key={day.label}>
          <div className="sh-faint sh-mono" style={{ fontSize: 10, marginBottom: 6 }}>
            {day.label}
          </div>
          <div
            style={{
              position: "relative",
              height: 60,
              background: "var(--bg-canvas)",
              borderRadius: 5,
              border: "1px solid var(--border-subtle)",
              overflow: "hidden",
            }}
          >
            {[6, 12, 18].map((h) => (
              <span
                key={h}
                style={{
                  position: "absolute",
                  left: `${(h / 24) * 100}%`,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: "var(--border-subtle)",
                }}
              />
            ))}
            {day.fires.map((f, j) => (
              <span
                key={j}
                style={{
                  position: "absolute",
                  left: `${f.hourFraction * 100}%`,
                  top: 4,
                  bottom: 4,
                  width: 3,
                  borderRadius: 1,
                  background: f.tone === "critical" ? "var(--sev-critical)" : "var(--sev-warning)",
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AlertRuleRow({ row, ctx }: { row: AlertRuleRowVM; ctx: ScreenCtx }) {
  return (
    <div className="sh-row alert-row" style={{ gridTemplateColumns: RULE_GRID }}>
      <div>
        <strong style={{ fontSize: 12.5 }}>{row.name}</strong>
        <div className="sh-faint sh-mono" style={{ fontSize: 11 }}>
          {row.subLabel}
        </div>
      </div>
      <span
        className={`sh-tag ${row.severityTag}`}
        style={{ textTransform: "uppercase", fontSize: 10, fontWeight: 700 }}
      >
        {row.severity}
      </span>
      <span>
        <span
          className="sh-tag"
          style={{
            background: row.enabled ? "var(--accent-bg-subtle)" : "var(--bg-surface-3)",
            color: row.enabled ? "var(--accent)" : "var(--fg-muted)",
            borderColor: "transparent",
          }}
        >
          {row.enabled ? "● active" : "paused"}
        </span>
      </span>
      <span style={{ fontSize: 12 }}>{row.channelLabel}</span>
      <span
        className="sh-mono"
        style={{
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
          color: row.fires7d > 0 ? "var(--sev-critical)" : "var(--fg-muted)",
        }}
      >
        {row.fires7d}
      </span>
      <div className="alert-row__actions" style={{ display: "flex", gap: 4 }}>
        <button
          className="sh-iconbtn-sm"
          title="Edit rule"
          onClick={() => ctx.pushToast("Rule editor is not yet available")}
        >
          <Icon name="edit" size={13} />
        </button>
        <button
          className="sh-iconbtn-sm"
          title={row.enabled ? "Pause" : "Resume"}
          onClick={() => ctx.pushToast(row.enabled ? `Pausing ${row.name}` : `Resuming ${row.name}`)}
        >
          <Icon name={row.enabled ? "clock" : "play"} size={13} />
        </button>
        <button
          className="sh-iconbtn-sm"
          title="Archive rule"
          onClick={() => ctx.pushToast(`Archiving ${row.name}`)}
        >
          <Icon name="archive" size={13} />
        </button>
      </div>
    </div>
  );
}

function ChannelRow({ row, ctx }: { row: ChannelRowVM; ctx: ScreenCtx }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "11px 16px",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <span style={{ color: row.ok ? "var(--accent)" : "var(--sev-warning)" }}>
        <Icon name={row.icon} size={16} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5 }}>{row.name}</div>
        <div
          className="sh-faint sh-mono"
          style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {row.target}
        </div>
      </div>
      <button
        className="sh-tag mono"
        style={{ cursor: "pointer" }}
        onClick={() => ctx.pushToast(`Test notification sent to ${row.name}`)}
      >
        test
      </button>
    </div>
  );
}

export function AlertsScreen({ ctx }: { ctx: ScreenCtx }) {
  const [filter, setFilter] = useState<RuleFilter>("All");
  const projectId = ctx.project?.id;
  const environmentId = ctx.environment?.id;

  const { data, status } = useAlerts({ client: ctx.client, projectId, environmentId });

  if (!ctx.project || !ctx.environment) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint
          icon="bell"
          title="No project selected"
          sub="Select a project and environment to view alerts."
        />
      </div>
    );
  }

  if (status === "loading" && !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="bell" title="Loading…" sub="Fetching alert rules and history." />
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="alert" title="Could not load alerts" sub="Check your connection or try again." />
      </div>
    );
  }

  const { header, rules, channels, timeline } = data;
  const shownRules = rules.filter((r) =>
    filter === "All" ? true : filter === "Active" ? r.enabled : !r.enabled,
  );

  return (
    <>
      <PageHead
        title="Alerts"
        sub={`${header.activeRuleCount} active rules · ${header.fires7d} fires in the last 7 days`}
        actions={
          <>
            <button
              className="sh-btn"
              onClick={() => ctx.pushToast("Channel management is not yet available")}
            >
              <Icon name="webhook" size={13} />
              Channels
            </button>
            <button
              className="sh-btn primary"
              onClick={() => ctx.pushToast("Rule editor is not yet available")}
            >
              <Icon name="plus" size={13} />
              New rule
            </button>
          </>
        }
      />

      <div className="sh-card">
        <div className="sh-card__head">
          <h2 className="sh-h2">Recent history</h2>
          <span className="sh-faint" style={{ fontSize: 11 }}>
            last 7 days
          </span>
        </div>
        <div className="sh-card__body">
          <FiresTimeline timeline={timeline} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16 }}>
        <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="sh-card__head">
            <h2 className="sh-h2">Rules</h2>
            <Segmented options={[...FILTERS]} value={filter} onChange={(v) => setFilter(v as RuleFilter)} />
          </div>
          <div className="sh-row sh-row__head" style={{ gridTemplateColumns: RULE_GRID }}>
            <span>Rule</span>
            <span>Severity</span>
            <span>State</span>
            <span>Channel</span>
            <span>7d</span>
            <span>Actions</span>
          </div>
          <div style={{ overflow: "auto", flex: 1 }}>
            {shownRules.length === 0 ? (
              <EmptyHint icon="bell" title="No alert rules" sub="No rules match this filter." />
            ) : (
              shownRules.map((row) => <AlertRuleRow key={row.id} row={row} ctx={ctx} />)
            )}
          </div>
        </div>

        <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="sh-card__head">
            <h2 className="sh-h2">Channels</h2>
            <button
              className="sh-btn ghost"
              style={{ padding: "4px 8px" }}
              onClick={() => ctx.pushToast("Channel management is not yet available")}
            >
              <Icon name="plus" size={13} />
            </button>
          </div>
          <div className="sh-card__body flush">
            {channels.length === 0 ? (
              <EmptyHint icon="webhook" title="No channels" sub="No notification channels configured." />
            ) : (
              channels.map((row) => <ChannelRow key={row.id} row={row} ctx={ctx} />)
            )}
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sigmon/console test -- AlertsScreen`
Expected: PASS (all 7 cases green).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @sigmon/console exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/v2/screens/AlertsScreen.tsx apps/console/src/v2/screens/AlertsScreen.test.tsx
git commit -m "feat(console): v2 AlertsScreen (rules table, fires timeline, channels)"
```

---

### Task 3: Flip the `alerts` registry entry to v2

**Files:**
- Modify: `apps/console/src/v2/screens/registry.tsx`
- Modify: `apps/console/src/v2/screens/registry.test.tsx`

**Interfaces:**
- Consumes: `AlertsScreen` from `./AlertsScreen`.
- Produces: `SCREENS.alerts` with `kind: "v2"`.

**Context:** `AlertsPanel` is still imported and rendered by `apps/console/src/components/ConsoleShell.tsx` (the legacy console). Do NOT touch `AlertsPanel.tsx` or `ConsoleShell.tsx` — only the v2 registry flips. After removing the `AlertsPanel` import from `registry.tsx`, confirm nothing else in `registry.tsx` references it.

- [ ] **Step 1: Add the failing registry test** — in `apps/console/src/v2/screens/registry.test.tsx`

Add this import alongside the other `import * as useXModule` lines near the top (after the `useTracesModule` import on line 11):

```tsx
import * as useAlertsModule from "./useAlerts";
```

Add these two tests immediately AFTER the "renders the v2 Traces screen…" test (i.e. right before the `it("wraps legacy entries in the legacy island", …)` test), so they live inside the describe block whose `afterEach` runs `vi.restoreAllMocks()`:

```tsx
  it("routes alerts to a v2 screen", () => {
    expect(SCREENS.alerts.kind).toBe("v2");
  });

  it("renders the v2 Alerts screen (not wrapped in the legacy island)", () => {
    vi.spyOn(useAlertsModule, "useAlerts").mockReturnValue({ data: null, status: "loading", reload: vi.fn() });
    const ctx = makeCtx();
    const node = renderSection("alerts", ctx);
    const { container } = render(<>{node}</>);
    expect(container.querySelector(".console-legacy-island")).toBeNull();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sigmon/console test -- registry`
Expected: FAIL — `SCREENS.alerts.kind` is `"legacy"`, and the alerts render is wrapped in `.console-legacy-island`.

- [ ] **Step 3: Edit `registry.tsx`**

Remove the legacy import (line 4):

```tsx
import { AlertsPanel } from "../../components/AlertsPanel";
```

Add an import alongside the other v2 screen imports (after the `LlmScreen` import):

```tsx
import { AlertsScreen } from "./AlertsScreen";
```

Replace the `alerts` entry:

```tsx
  alerts: {
    kind: "legacy",
    render: (ctx) => (
      <AlertsPanel
        client={ctx.client}
        projectId={ctx.project?.id}
        environmentId={ctx.environment?.id}
      />
    ),
  },
```

with:

```tsx
  alerts: {
    kind: "v2",
    render: (ctx) => <AlertsScreen ctx={ctx} />,
  },
```

- [ ] **Step 4: Run the registry test to verify it passes**

Run: `pnpm --filter @sigmon/console test -- registry`
Expected: PASS (alerts routed to v2, not wrapped in the legacy island).

- [ ] **Step 5: Typecheck + full console test suite**

Run: `pnpm --filter @sigmon/console exec tsc --noEmit`
Then: `pnpm --filter @sigmon/console test`
Expected: no type errors; all console tests pass (no `AlertsPanel`-unused error in `registry.tsx`).

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/v2/screens/registry.tsx apps/console/src/v2/screens/registry.test.tsx
git commit -m "feat(console): route alerts to the v2 AlertsScreen"
```

---

## Self-Review notes (author)

- **Spec coverage:** fires timeline (T1 buckets + T2 `FiresTimeline`), rules table w/ filter (T2), channels list (T2), header counts (T1+T2), registry flip (T3), Suggestions deliberately omitted (B4), mutations stubbed. ✓
- **Duplicate-text:** "Channels" (head button + card head) → `getAllByText`; "Slack · #incidents" (rule channel column + channel card) → `getAllByText`; severity text asserted lowercase; "● active"/"paused"/"Paused"(Segmented) are distinct exact strings. ✓
- **Type consistency:** `SeverityTag` union `"critical"|"warn"|""`; `buildAlertsVM(input, nowMs)` signature identical in hook call and tests; `useAlerts` client arg requires the three real `ApiClient` methods; `eventsRes.data` matches `QueryListResponse`. ✓
- **jsdom pragma** on both new test files (line 1). ✓
