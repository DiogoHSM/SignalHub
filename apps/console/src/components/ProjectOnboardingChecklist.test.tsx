import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Environment } from "../api/types";
import { ProjectOnboardingChecklist } from "./ProjectOnboardingChecklist";

const environment: Environment = {
  id: "env_1",
  projectId: "prj_1",
  name: "production",
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
  archivedAt: null
};

afterEach(() => {
  cleanup();
});

describe("ProjectOnboardingChecklist", () => {
  it("summarizes completed and pending setup steps for the selected environment", () => {
    render(
      <ProjectOnboardingChecklist
        activeEnvironment={environment}
        activeProjectId="prj_1"
        apiEndpoint="https://my.sigmon.app"
        latestSecret={undefined}
      />
    );

    expect(screen.getByRole("heading", { name: "Setup checklist" })).toBeInTheDocument();
    expect(screen.getByText("3 of 7 ready")).toBeInTheDocument();
    expect(screen.getByText("Project selected")).toBeInTheDocument();
    expect(screen.getByText("production environment selected")).toBeInTheDocument();
    expect(screen.getByText("API endpoint available")).toBeInTheDocument();
    expect(screen.getByText("Create and copy an API key")).toBeInTheDocument();
    expect(screen.getByText("Generate a key and copy the one-time secret before integrating the SDK.")).toBeInTheDocument();
    expect(screen.getByText("Install SDK package")).toBeInTheDocument();
    expect(screen.getByText("npm install @sigmon/sdk")).toBeInTheDocument();
    expect(screen.getByText("Initialize SDK snippet")).toBeInTheDocument();
    expect(screen.getByText("Send first ping")).toBeInTheDocument();
  });
});
