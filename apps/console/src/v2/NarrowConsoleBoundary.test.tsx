// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NarrowConsoleBoundary } from "./NarrowConsoleBoundary";

type Listener = (event: MediaQueryListEvent) => void;

function installViewport(width: number) {
  const listeners = new Set<Listener>();
  let matches = width <= 899;
  const media = "(max-width: 899px)";
  const addEventListener = vi.fn((_type: "change", listener: Listener) => listeners.add(listener));
  const removeEventListener = vi.fn((_type: "change", listener: Listener) => listeners.delete(listener));
  const mediaQueryList = {
    get matches() {
      return matches;
    },
    media,
    onchange: null,
    addEventListener,
    removeEventListener,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;

  const matchMedia = vi.fn((query: string) => {
    expect(query).toBe(media);
    return mediaQueryList;
  });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: matchMedia });

  return {
    matchMedia,
    mediaQueryList,
    addEventListener,
    removeEventListener,
    resize(nextWidth: number) {
      matches = nextWidth <= 899;
      const event = { matches, media } as MediaQueryListEvent;
      for (const listener of listeners) listener(event);
    },
  };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("NarrowConsoleBoundary", () => {
  it.each([390, 768, 899])("hands a %ipx dense route to mobile status", (width) => {
    installViewport(width);
    render(
      <NarrowConsoleBoundary>
        <div data-testid="dense-route">Dense route</div>
      </NarrowConsoleBoundary>,
    );

    expect(screen.queryByTestId("dense-route")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open mobile status/i })).toHaveAttribute("href", "/console/status");
  });

  it.each([900, 1280])("keeps the dense route mounted at %ipx", (width) => {
    installViewport(width);
    render(
      <NarrowConsoleBoundary>
        <div data-testid="dense-route">Dense route</div>
      </NarrowConsoleBoundary>,
    );

    expect(screen.getByTestId("dense-route")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open mobile status/i })).not.toBeInTheDocument();
  });

  it("updates on media-query changes without remounting the boundary and removes its listener", () => {
    const viewport = installViewport(900);
    const { unmount } = render(<NarrowConsoleBoundary><div>Dense route</div></NarrowConsoleBoundary>);

    expect(screen.getByText("Dense route")).toBeInTheDocument();
    expect(viewport.addEventListener).toHaveBeenCalledTimes(1);
    expect(viewport.matchMedia).toHaveBeenCalledTimes(2);

    act(() => viewport.resize(899));
    expect(screen.queryByText("Dense route")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open mobile status/i })).toBeInTheDocument();

    act(() => viewport.resize(900));
    expect(screen.getByText("Dense route")).toBeInTheDocument();
    expect(viewport.matchMedia).toHaveBeenCalledTimes(2);

    unmount();
    expect(viewport.removeEventListener).toHaveBeenCalledTimes(1);
    expect(viewport.removeEventListener).toHaveBeenCalledWith(
      "change",
      viewport.addEventListener.mock.calls[0]?.[1],
    );
  });

  it("renders the dense route when matchMedia is unavailable", () => {
    Reflect.deleteProperty(window, "matchMedia");
    render(<NarrowConsoleBoundary><div>Dense route</div></NarrowConsoleBoundary>);
    expect(screen.getByText("Dense route")).toBeInTheDocument();
  });
});
