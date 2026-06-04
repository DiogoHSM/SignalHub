import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment } from "../api/types";
import { EnvironmentSelector } from "./EnvironmentSelector";

const production: Environment = {
  id: "env_1",
  projectId: "prj_1",
  name: "production",
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
  archivedAt: null
};

const preview: Environment = {
  ...production,
  id: "env_2",
  name: "preview"
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("EnvironmentSelector", () => {
  it("lets operators rename and archive environments when management actions are provided", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const onArchive = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <EnvironmentSelector
        activeEnvironmentId="env_1"
        disabled={false}
        environments={[production, preview]}
        onArchive={onArchive}
        onCreate={vi.fn()}
        onSelect={vi.fn()}
        onUpdate={onUpdate}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Edit production" }));
    await userEvent.clear(screen.getByLabelText("Environment name"));
    await userEvent.type(screen.getByLabelText("Environment name"), "prod");
    await userEvent.click(screen.getByRole("button", { name: "Save environment" }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(production, "prod"));

    await userEvent.click(screen.getByRole("button", { name: "Archive preview" }));

    expect(window.confirm).toHaveBeenCalledWith("Archive environment preview?");
    await waitFor(() => expect(onArchive).toHaveBeenCalledWith(preview));
  });
});
