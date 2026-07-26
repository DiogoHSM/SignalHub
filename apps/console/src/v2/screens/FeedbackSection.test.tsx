// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../api/client";
import type { Environment, FeedbackItem, FeedbackWidgetSettings, Project } from "../../api/types";
import type { NavSection } from "../nav";
import { FeedbackSection } from "./FeedbackSection";
import type { ScreenCtx } from "./registry";

afterEach(cleanup);

const project: Project = { id: "prj_1", name: "Acme", createdAt: "x", updatedAt: "x", archivedAt: null };
const environment: Environment = { id: "env_1", projectId: "prj_1", name: "production", createdAt: "x", updatedAt: "x", archivedAt: null };

const widgetSettings: FeedbackWidgetSettings = {
  projectId: "prj_1", environmentId: "env_1", enabled: true, title: "Send feedback",
  prompt: "Tell us what happened.", placeholder: "Write your feedback...", buttonLabel: "Feedback",
  accentColor: "#66e38a", allowScreenshot: false, privacyNote: null,
  createdAt: "2026-06-24T09:00:00.000Z", updatedAt: "2026-06-24T09:00:00.000Z",
};

const feedbackItem: FeedbackItem = {
  id: "fb_1", projectId: "prj_1", environmentId: "env_1", status: "open", message: "Broke on save",
  category: null, pageUrl: "https://app.example.com/settings", path: "/settings",
  tenantId: "tenant_1", userId: "user_1", sessionId: "sess_1", traceId: "trace_1",
  release: "1.4.0", source: "widget", userAgent: null, metadata: {},
  submittedAt: "2026-06-24T11:48:00.000Z", receivedAt: "2026-06-24T11:48:01.000Z", updatedAt: "2026-06-24T11:48:01.000Z",
};

function makeClient(over: Partial<ApiClient> = {}): ApiClient {
  return {
    getFeedbackWidgetSettings: vi.fn().mockResolvedValue({ settings: widgetSettings }),
    updateFeedbackWidgetSettings: vi.fn().mockResolvedValue({ settings: { ...widgetSettings, enabled: false } }),
    listFeedbackItems: vi.fn().mockResolvedValue({ feedback: [feedbackItem] }),
    updateFeedbackStatus: vi.fn().mockResolvedValue({ feedback: { ...feedbackItem, status: "reviewed" } }),
    ...over,
  } as unknown as ApiClient;
}

function makeCtx(over: Partial<ScreenCtx> = {}): ScreenCtx {
  return {
    client: makeClient(),
    project,
    environment,
    environments: [environment],
    onCreateEnvironment: vi.fn(),
    onArchiveEnvironment: vi.fn(),
    onArchiveProject: vi.fn(),
    onSecretCreated: vi.fn(),
    onSelectEnvironment: vi.fn(),
    onUpdateProject: vi.fn(),
    onUpdateEnvironment: vi.fn(),
    navigate: vi.fn() as (s: NavSection) => void,
    back: vi.fn(),
    drill: vi.fn(),
    pushToast: vi.fn(),
    ...over,
  };
}

describe("FeedbackSection", () => {
  it("renders widget settings and the recent feedback list", async () => {
    render(<FeedbackSection ctx={makeCtx()} />);
    expect(await screen.findByText("Widget settings")).toBeInTheDocument();
    expect(screen.getByText("Recent feedback")).toBeInTheDocument();
    expect(screen.getByText("Broke on save")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Feedback")).toBeInTheDocument();
  });

  it("shows context chips and an open trace link when traceId is present", async () => {
    render(<FeedbackSection ctx={makeCtx()} />);
    await screen.findByText("Broke on save");
    expect(screen.getByText("tenant tenant_1")).toBeInTheDocument();
    expect(screen.getByText("user user_1")).toBeInTheDocument();
    expect(screen.getByText("session sess_1")).toBeInTheDocument();
    expect(screen.getByText(/trace/)).toBeInTheDocument();
  });

  it("navigates to the traces section without filters when the trace chip is clicked (PER-434 not yet merged)", async () => {
    const ctx = makeCtx();
    render(<FeedbackSection ctx={ctx} />);
    const traceBtn = await screen.findByTitle(/Jump to Traces/i);
    fireEvent.click(traceBtn);
    expect(ctx.navigate).toHaveBeenCalledWith("traces");
  });

  it("saves widget settings from the compact form", async () => {
    const client = makeClient();
    render(<FeedbackSection ctx={makeCtx({ client })} />);
    const buttonLabelInput = await screen.findByLabelText("Button label");
    fireEvent.change(buttonLabelInput, { target: { value: "Send feedback now" } });
    fireEvent.click(screen.getByRole("button", { name: "Save widget" }));
    await waitFor(() =>
      expect(client.updateFeedbackWidgetSettings).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "prj_1", environmentId: "env_1", buttonLabel: "Send feedback now" }),
      ),
    );
  });

  it("marks a feedback item as reviewed", async () => {
    const client = makeClient();
    render(<FeedbackSection ctx={makeCtx({ client })} />);
    const reviewBtn = await screen.findByRole("button", { name: "Mark reviewed: Broke on save" });
    fireEvent.click(reviewBtn);
    await waitFor(() =>
      expect(client.updateFeedbackStatus).toHaveBeenCalledWith("fb_1", { projectId: "prj_1", environmentId: "env_1" }, "reviewed"),
    );
  });

  it("archives a feedback item", async () => {
    const client = makeClient();
    render(<FeedbackSection ctx={makeCtx({ client })} />);
    const archiveBtn = await screen.findByRole("button", { name: "Archive: Broke on save" });
    fireEvent.click(archiveBtn);
    await waitFor(() =>
      expect(client.updateFeedbackStatus).toHaveBeenCalledWith("fb_1", { projectId: "prj_1", environmentId: "env_1" }, "archived"),
    );
  });

  it("renders nothing when the feedback API is unavailable on this deployment", async () => {
    const { container } = render(<FeedbackSection ctx={makeCtx({ client: {} as unknown as ApiClient })} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("shows an empty hint when there is no feedback yet", async () => {
    const client = makeClient({ listFeedbackItems: vi.fn().mockResolvedValue({ feedback: [] }) });
    render(<FeedbackSection ctx={makeCtx({ client })} />);
    expect(await screen.findByText(/No feedback received yet/i)).toBeInTheDocument();
  });
});
