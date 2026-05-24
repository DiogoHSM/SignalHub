import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { ErrorGroupIncident } from "../api/types";
import { IncidentTriagePanel } from "./IncidentTriagePanel";
import { IncidentView } from "./IncidentView";

type IncidentFixtureOverrides = Partial<Omit<ErrorGroupIncident, "group" | "primaryOccurrence" | "related">> & {
  group?: Partial<ErrorGroupIncident["group"]>;
  primaryOccurrence?: Partial<ErrorGroupIncident["primaryOccurrence"]>;
  related?: Partial<ErrorGroupIncident["related"]>;
};

function incidentFixture(overrides: IncidentFixtureOverrides = {}): ErrorGroupIncident {
  const base: ErrorGroupIncident = {
    group: {
      id: "egrp_checkout",
      projectId: "prj_1",
      environmentId: "env_1",
      groupingFingerprint: "fp_checkout",
      message: "Checkout failed",
      type: "Error",
      topStackFrame: "at checkout.js:10:2",
      severity: "critical",
      status: "open",
      priority: null,
      firstSeenAt: "2026-05-24T12:00:00.000Z",
      lastSeenAt: "2026-05-24T12:05:00.000Z",
      lastRegressedAt: null,
      occurrenceCount: 5,
      affectedUsersCount: 2,
      affectedTenantsCount: 1,
      latestErrorId: "err_1",
      latestRelease: "web@1",
      resolvedAt: null,
      ignoredAt: null,
      createdAt: "2026-05-24T12:00:00.000Z",
      updatedAt: "2026-05-24T12:05:00.000Z"
    },
    primaryOccurrence: {
      id: "err_1",
      projectId: "prj_1",
      environmentId: "env_1",
      tenantId: "tenant_1",
      userId: "user_1",
      sessionId: "session_1",
      traceId: "trace_1",
      timestamp: "2026-05-24T12:05:00.000Z",
      receivedAt: "2026-05-24T12:05:01.000Z",
      source: "browser",
      release: "web@1",
      metadata: { route: "/checkout" },
      message: "Checkout failed",
      type: "Error",
      severity: "critical",
      stack: "Error: Checkout failed\n    at checkout.js:10:2",
      status: "open",
      fingerprint: "fp_checkout",
      errorGroupId: "egrp_checkout",
      groupingFingerprint: "fp_checkout",
      context: { cartId: "cart_1" }
    },
    priority: null,
    suggestedPriority: "urgent",
    sourceMapResolution: { status: "cached", frameCount: 2 },
    stronglyRelated: {
      items: [
        {
          id: "evt_1",
          kind: "event",
          confidence: "strong",
          timestamp: "2026-05-24T12:04:00.000Z",
          tenantId: "tenant_1",
          userId: "user_1",
          sessionId: "session_1",
          traceId: "trace_1",
          release: "web@1",
          title: "checkout.started",
          level: null,
          data: {}
        }
      ],
      truncated: false
    },
    nearbyContext: {
      items: [
        {
          id: "llm_1",
          kind: "llm",
          confidence: "nearby",
          timestamp: "2026-05-24T12:03:00.000Z",
          tenantId: "tenant_1",
          userId: "user_1",
          sessionId: "session_1",
          traceId: "trace_1",
          release: "web@1",
          title: "openai gpt-4.1-mini",
          level: null,
          data: {}
        }
      ],
      truncated: false
    },
    related: {
      traceId: "trace_1",
      sessionId: "session_1",
      userId: "user_1",
      tenantId: "tenant_1",
      release: "web@1"
    }
  };
  return {
    ...base,
    ...overrides,
    group: { ...base.group, ...overrides.group },
    primaryOccurrence: { ...base.primaryOccurrence, ...overrides.primaryOccurrence },
    related: { ...base.related, ...overrides.related }
  };
}

function clientWithIncident(incident: ErrorGroupIncident = incidentFixture()): ApiClient {
  return {
    getErrorGroupIncident: vi.fn().mockResolvedValue({ data: incident }),
    updateErrorGroupTriage: vi.fn().mockResolvedValue({
      data: { ...incident.group, priority: "high" }
    })
  } as unknown as ApiClient;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
});

describe("IncidentView", () => {
  it("renders incident summary, technical details, and timelines", async () => {
    const api = clientWithIncident();

    render(
      <IncidentView
        client={api}
        environmentId="env_1"
        groupId="egrp_checkout"
        onBack={vi.fn()}
        projectId="prj_1"
      />
    );

    expect(await screen.findByRole("heading", { name: "Checkout failed" })).toBeInTheDocument();
    expect(screen.getByText("urgent suggested")).toBeInTheDocument();
    expect(screen.getByText("5 occurrences")).toBeInTheDocument();
    expect(screen.getByText("2 users")).toBeInTheDocument();
    expect(screen.getByText("Source map: 2 frames")).toBeInTheDocument();
    expect(screen.getByText(/Error: Checkout failed/)).toBeInTheDocument();
    expect(within(screen.getByLabelText("Strongly related timeline")).getByText("checkout.started")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Nearby context timeline")).getByText("openai gpt-4.1-mini")).toBeInTheDocument();
  });

  it("saves triage status and priority with the active scope", async () => {
    const api = clientWithIncident();

    render(
      <IncidentView
        client={api}
        environmentId="env_1"
        groupId="egrp_checkout"
        onBack={vi.fn()}
        projectId="prj_1"
      />
    );

    await screen.findByRole("heading", { name: "Checkout failed" });
    await userEvent.selectOptions(screen.getByLabelText("Priority"), "high");
    await userEvent.click(screen.getByRole("button", { name: "Save triage" }));

    await waitFor(() =>
      expect(api.updateErrorGroupTriage).toHaveBeenCalledWith("egrp_checkout", {
        projectId: "prj_1",
        environmentId: "env_1",
        status: "open",
        priority: "high"
      })
    );
  });

  it("resets rendered incident and triage controls when the route changes", async () => {
    const nextIncident = incidentFixture({
      group: {
        id: "egrp_billing",
        groupingFingerprint: "fp_billing",
        message: "Billing failed",
        status: "investigating",
        priority: "low"
      },
      primaryOccurrence: {
        id: "err_2",
        message: "Billing failed",
        stack: "Error: Billing failed",
        errorGroupId: "egrp_billing",
        groupingFingerprint: "fp_billing"
      },
      suggestedPriority: "normal"
    });
    const api = {
      getErrorGroupIncident: vi
        .fn()
        .mockResolvedValueOnce({ data: incidentFixture() })
        .mockResolvedValueOnce({ data: nextIncident }),
      updateErrorGroupTriage: vi.fn()
    } as unknown as ApiClient;

    const { rerender } = render(
      <IncidentView
        client={api}
        environmentId="env_1"
        groupId="egrp_checkout"
        onBack={vi.fn()}
        projectId="prj_1"
      />
    );

    await screen.findByRole("heading", { name: "Checkout failed" });
    await userEvent.selectOptions(screen.getByLabelText("Priority"), "high");

    rerender(
      <IncidentView
        client={api}
        environmentId="env_1"
        groupId="egrp_billing"
        onBack={vi.fn()}
        projectId="prj_1"
      />
    );

    expect(screen.queryByRole("heading", { name: "Checkout failed" })).not.toBeInTheDocument();
    expect(screen.getByText("Loading incident")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Billing failed" })).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toHaveValue("investigating");
    expect(screen.getByLabelText("Priority")).toHaveValue("low");
  });

  it("ignores stale triage saves that resolve after the route changes", async () => {
    const checkoutIncident = incidentFixture();
    const billingIncident = incidentFixture({
      group: {
        id: "egrp_billing",
        groupingFingerprint: "fp_billing",
        message: "Billing failed",
        status: "investigating",
        priority: "low"
      },
      primaryOccurrence: {
        id: "err_2",
        message: "Billing failed",
        stack: "Error: Billing failed",
        errorGroupId: "egrp_billing",
        groupingFingerprint: "fp_billing"
      },
      suggestedPriority: "normal"
    });
    const save = deferred<{ data: ErrorGroupIncident["group"] }>();
    const api = {
      getErrorGroupIncident: vi
        .fn()
        .mockResolvedValueOnce({ data: checkoutIncident })
        .mockResolvedValueOnce({ data: billingIncident }),
      updateErrorGroupTriage: vi.fn().mockReturnValue(save.promise)
    } as unknown as ApiClient;

    const { rerender } = render(
      <IncidentView
        client={api}
        environmentId="env_1"
        groupId="egrp_checkout"
        onBack={vi.fn()}
        projectId="prj_1"
      />
    );

    await screen.findByRole("heading", { name: "Checkout failed" });
    await userEvent.selectOptions(screen.getByLabelText("Priority"), "high");
    await userEvent.click(screen.getByRole("button", { name: "Save triage" }));
    expect(api.updateErrorGroupTriage).toHaveBeenCalledWith("egrp_checkout", {
      projectId: "prj_1",
      environmentId: "env_1",
      status: "open",
      priority: "high"
    });

    rerender(
      <IncidentView
        client={api}
        environmentId="env_1"
        groupId="egrp_billing"
        onBack={vi.fn()}
        projectId="prj_1"
      />
    );

    expect(await screen.findByRole("heading", { name: "Billing failed" })).toBeInTheDocument();

    await act(async () => {
      save.resolve({ data: { ...checkoutIncident.group, priority: "high" } });
      await save.promise;
    });

    expect(screen.getByRole("heading", { name: "Billing failed" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Checkout failed" })).not.toBeInTheDocument();
    expect(screen.queryByText("Loading incident")).not.toBeInTheDocument();
  });

  it("syncs triage controls when the incident changes without remounting", async () => {
    const nextIncident = incidentFixture({
      group: {
        id: "egrp_billing",
        groupingFingerprint: "fp_billing",
        message: "Billing failed",
        status: "investigating",
        priority: "low"
      }
    });
    const api = clientWithIncident();

    const { rerender } = render(
      <IncidentTriagePanel
        client={api}
        environmentId="env_1"
        incident={incidentFixture()}
        onUpdated={vi.fn()}
        projectId="prj_1"
      />
    );

    await userEvent.selectOptions(screen.getByLabelText("Priority"), "high");

    rerender(
      <IncidentTriagePanel
        client={api}
        environmentId="env_1"
        incident={nextIncident}
        onUpdated={vi.fn()}
        projectId="prj_1"
      />
    );

    expect(screen.getByLabelText("Status")).toHaveValue("investigating");
    expect(screen.getByLabelText("Priority")).toHaveValue("low");
  });
});
