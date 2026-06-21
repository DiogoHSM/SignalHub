import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { EventRecord } from "../api/types";
import { ExperimentsPanel } from "./ExperimentsPanel";

function eventRecord(overrides: Partial<EventRecord>): EventRecord {
  return {
    id: "evt_1",
    projectId: "prj_1",
    environmentId: "env_1",
    tenantId: "tenant_1",
    userId: "user_1",
    sessionId: "session_1",
    traceId: "trace_1",
    timestamp: "2026-05-05T12:00:00.000Z",
    receivedAt: "2026-05-05T12:00:01.000Z",
    source: "browser",
    release: "1.0.0",
    metadata: {},
    name: "checkout.exposed",
    properties: {},
    ...overrides
  };
}

function client(overrides: Partial<ApiClient>): ApiClient {
  return {
    listEvents: vi.fn().mockResolvedValue({ data: [] }),
    ...overrides
  } as ApiClient;
}

afterEach(() => {
  cleanup();
});

describe("ExperimentsPanel", () => {
  it("filters the variant readout by the selected experiment", async () => {
    const user = userEvent.setup();
    const api = client({
      listEvents: vi.fn().mockResolvedValue({
        data: [
          eventRecord({ id: "evt_a1", name: "checkout.exposed", properties: { experiment: "checkout_copy", variant: "A" } }),
          eventRecord({ id: "evt_a2", name: "checkout.completed", properties: { experiment: "checkout_copy", variant: "A" } }),
          eventRecord({ id: "evt_b1", name: "checkout.exposed", properties: { experiment: "checkout_copy", variant: "B" } }),
          eventRecord({ id: "evt_pc1", name: "checkout.exposed", properties: { experiment: "pricing_copy", variant: "control" } }),
          eventRecord({ id: "evt_pc2", name: "checkout.exposed", properties: { experiment: "pricing_copy", variant: "control" } }),
          eventRecord({ id: "evt_pc3", name: "checkout.completed", properties: { experiment: "pricing_copy", variant: "control" } }),
          eventRecord({ id: "evt_pt1", name: "checkout.exposed", properties: { experiment: "pricing_copy", variant: "treatment" } }),
          eventRecord({ id: "evt_pt2", name: "checkout.exposed", properties: { experiment: "pricing_copy", variant: "treatment" } }),
          eventRecord({ id: "evt_pt3", name: "checkout.completed", properties: { experiment: "pricing_copy", variant: "treatment" } }),
          eventRecord({ id: "evt_pt4", name: "checkout.completed", properties: { experiment: "pricing_copy", variant: "treatment" } })
        ]
      })
    });

    render(<ExperimentsPanel client={api} environmentId="env_1" projectId="prj_1" />);

    const experimentSelect = await screen.findByLabelText("Experiment");
    expect(experimentSelect).toHaveValue("checkout_copy");
    expect(within(screen.getByRole("region", { name: "A/B test readout" })).getByRole("row", { name: /Variant A/ })).toHaveTextContent("100.0%");

    await user.selectOptions(experimentSelect, "pricing_copy");

    const readout = screen.getByRole("region", { name: "A/B test readout" });
    await waitFor(() => expect(within(readout).getByRole("row", { name: /Variant control/ })).toHaveTextContent("50.0%"));
    expect(within(readout).getByRole("row", { name: /Variant treatment/ })).toHaveTextContent("100.0%");
    expect(within(readout).getByRole("row", { name: /Variant treatment/ })).toHaveTextContent("+50.0 pp");
    expect(within(readout).queryByRole("row", { name: /Variant A/ })).not.toBeInTheDocument();
  });
});
