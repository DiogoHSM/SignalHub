import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSharedGroupLoader, LazyScreen, selectLazyExport } from "./LazyScreen";

afterEach(cleanup);

describe("LazyScreen", () => {
  it("shows the console loading state until a shared screen group resolves", async () => {
    let resolveGroup: ((value: { DemoScreen: typeof DemoScreen }) => void) | undefined;
    const importer = vi.fn(() => new Promise<{ DemoScreen: typeof DemoScreen }>((resolve) => {
      resolveGroup = resolve;
    }));
    const group = createSharedGroupLoader(importer);

    render(<LazyScreen loader={selectLazyExport(group, "DemoScreen")} props={{ label: "ready" }} />);

    expect(screen.getByRole("status", { name: "Loading workspace" })).toBeInTheDocument();
    expect(importer).toHaveBeenCalledTimes(1);

    resolveGroup?.({ DemoScreen });
    expect(await screen.findByText("ready")).toBeInTheDocument();
  });

  it("reuses one import promise across screens in the same group", async () => {
    const importer = vi.fn<() => Promise<{ FirstScreen: typeof DemoScreen; SecondScreen: typeof DemoScreen }>>()
      .mockResolvedValue({ FirstScreen: DemoScreen, SecondScreen: DemoScreen });
    const group = createSharedGroupLoader(importer);

    render(
      <>
        <LazyScreen loader={selectLazyExport(group, "FirstScreen")} props={{ label: "first" }} />
        <LazyScreen loader={selectLazyExport(group, "SecondScreen")} props={{ label: "second" }} />
      </>,
    );

    expect(await screen.findByText("first")).toBeInTheDocument();
    expect(await screen.findByText("second")).toBeInTheDocument();
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it("clears a rejected group promise and retries from the error state", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const importer = vi.fn<() => Promise<{ DemoScreen: typeof DemoScreen }>>()
      .mockRejectedValueOnce(new Error("chunk unavailable"))
      .mockResolvedValueOnce({ DemoScreen });
    const group = createSharedGroupLoader(importer);

    render(<LazyScreen loader={selectLazyExport(group, "DemoScreen")} props={{ label: "recovered" }} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this workspace");
    fireEvent.click(screen.getByRole("button", { name: "Retry loading workspace" }));

    expect(await screen.findByText("recovered")).toBeInTheDocument();
    expect(importer).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });
});

function DemoScreen({ label }: { label: string }) {
  return <div>{label}</div>;
}
