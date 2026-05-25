import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SnippetPanel } from "./SnippetPanel";

afterEach(() => {
  cleanup();
});

describe("SnippetPanel", () => {
  it("renders SDK and HTTP snippets with key scope context", () => {
    render(
      <SnippetPanel
        apiEndpoint="https://sigmon.example.com"
        environmentId="env_1"
        latestSecret="sh_secret_value"
        projectId="prj_1"
      />
    );

    expect(screen.getByRole("heading", { name: "Snippets" })).toBeInTheDocument();
    expect(screen.getByText("SDK")).toBeInTheDocument();
    expect(screen.getByText("Next.js App Router")).toBeInTheDocument();
    expect(screen.getByText("HTTP")).toBeInTheDocument();
    expect(screen.getByText("Environment")).toBeInTheDocument();
    expect(screen.getByText(/createSignalMonitorClient/)).toBeInTheDocument();
    expect(screen.getByText(/@sigmon\/sdk\/next/)).toBeInTheDocument();
    expect(screen.getByText(/withSignalMonitorRoute/)).toBeInTheDocument();
    expect(screen.getAllByText(/https:\/\/sigmon.example.com/)).toHaveLength(4);
    expect(screen.getByText(/SIGMON_ENDPOINT=https:\/\/sigmon.example.com/)).toBeInTheDocument();
    expect(screen.getByText(/SIGMON_PROJECT_ID=prj_1/)).toBeInTheDocument();
    expect(screen.getByText(/SIGMON_ENVIRONMENT_ID=env_1/)).toBeInTheDocument();
    expect(screen.getByText(/\/v1\/events/)).toBeInTheDocument();
    expect(screen.getAllByText(/Key scope: prj_1 \/ env_1/)).toHaveLength(2);
    expect(screen.getAllByText(/sh_secret_value/)).toHaveLength(3);
  });

  it("uses the SIGMON_API_KEY placeholder without a fresh one-time secret", () => {
    render(<SnippetPanel environmentId="env_1" projectId="prj_1" />);

    expect(screen.getAllByText(/SIGMON_API_KEY/)).toHaveLength(4);
    expect(screen.queryByText(/sh_secret_value/)).not.toBeInTheDocument();
  });
});
