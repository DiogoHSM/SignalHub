import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { ErrorGroupIncident } from "../api/types";
import { IncidentView } from "./IncidentView";

function incidentFixture(): ErrorGroupIncident {
  return {
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
}

function clientWithIncident(incident: ErrorGroupIncident = incidentFixture()): ApiClient {
  return {
    getErrorGroupIncident: vi.fn().mockResolvedValue({ data: incident }),
    updateErrorGroupTriage: vi.fn().mockResolvedValue({
      data: { ...incident.group, priority: "high" }
    })
  } as unknown as ApiClient;
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
});
