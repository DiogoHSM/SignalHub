import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SnippetPanel } from "./SnippetPanel";

afterEach(() => {
  cleanup();
});

describe("SnippetPanel", () => {
  it("renders SDK and HTTP snippets with key scope context", () => {
    render(<SnippetPanel environmentId="env_1" latestSecret="sh_secret_value" projectId="prj_1" />);

    expect(screen.getByRole("heading", { name: "Snippets" })).toBeInTheDocument();
    expect(screen.getByText("SDK")).toBeInTheDocument();
    expect(screen.getByText("HTTP")).toBeInTheDocument();
    expect(screen.getByText("Environment")).toBeInTheDocument();
    expect(screen.getByText(/createSignalHubClient/)).toBeInTheDocument();
    expect(screen.getAllByText(/http:\/\/localhost:3000/)).toHaveLength(3);
    expect(screen.getByText(/SIGNAL_HUB_ENDPOINT=http:\/\/localhost:3000/)).toBeInTheDocument();
    expect(screen.getByText(/SIGNAL_HUB_PROJECT_ID=prj_1/)).toBeInTheDocument();
    expect(screen.getByText(/SIGNAL_HUB_ENVIRONMENT_ID=env_1/)).toBeInTheDocument();
    expect(screen.getByText(/\/v1\/events/)).toBeInTheDocument();
    expect(screen.getAllByText(/Key scope: prj_1 \/ env_1/)).toHaveLength(2);
    expect(screen.getAllByText(/sh_secret_value/)).toHaveLength(3);
  });

  it("uses the SIGNAL_HUB_API_KEY placeholder without a fresh one-time secret", () => {
    render(<SnippetPanel environmentId="env_1" projectId="prj_1" />);

    expect(screen.getAllByText(/SIGNAL_HUB_API_KEY/)).toHaveLength(3);
    expect(screen.queryByText(/sh_secret_value/)).not.toBeInTheDocument();
  });
});
