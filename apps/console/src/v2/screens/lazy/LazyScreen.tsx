import { Component, Suspense, lazy, useMemo, useState, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { EmptyHint } from "../../../components/ui/v2";

export type SharedGroupLoader<TModule> = {
  load: () => Promise<TModule>;
  reset: () => void;
};

export type SelectedScreenLoader<TProps extends object> = {
  load: () => Promise<{ default: ComponentType<TProps> }>;
  reset: () => void;
};

export function createSharedGroupLoader<TModule>(importer: () => Promise<TModule>): SharedGroupLoader<TModule> {
  let pending: Promise<TModule> | null = null;
  return {
    load: () => {
      pending ??= importer();
      return pending;
    },
    reset: () => {
      pending = null;
    },
  };
}

export function selectLazyExport<
  TModule,
  TKey extends keyof TModule,
  TProps extends object,
>(
  group: SharedGroupLoader<TModule>,
  key: TKey,
): SelectedScreenLoader<TProps> {
  return {
    load: async () => ({ default: (await group.load())[key] as ComponentType<TProps> }),
    reset: group.reset,
  };
}

type BoundaryProps = {
  children: ReactNode;
  onRetry: () => void;
  resetKey: number;
};

type BoundaryState = { error: Error | null };

class ScreenLoadBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Could not load console workspace", error, info);
  }

  componentDidUpdate(previous: BoundaryProps) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={{ minHeight: 280, display: "grid", placeItems: "center", padding: 32 }}>
        <div style={{ display: "grid", justifyItems: "center", gap: 16 }}>
          <EmptyHint
            icon="alert"
            title="Could not load this workspace"
            sub="The screen bundle could not be downloaded. Check your connection and try again."
          />
          <button className="sh-btn" type="button" onClick={this.props.onRetry}>
            Retry loading workspace
          </button>
        </div>
      </div>
    );
  }
}

export function LazyScreen<TProps extends object>({
  loader,
  props,
}: {
  loader: SelectedScreenLoader<TProps>;
  props: TProps;
}) {
  const [attempt, setAttempt] = useState(0);
  const Screen = useMemo(() => lazy(loader.load), [attempt, loader]);

  const retry = () => {
    loader.reset();
    setAttempt((value) => value + 1);
  };

  return (
    <ScreenLoadBoundary onRetry={retry} resetKey={attempt}>
      <Suspense fallback={<ScreenLoadingState />}>
        <Screen {...props} />
      </Suspense>
    </ScreenLoadBoundary>
  );
}

function ScreenLoadingState() {
  return (
    <div
      role="status"
      aria-label="Loading workspace"
      style={{ minHeight: 280, display: "grid", placeItems: "center", padding: 32 }}
    >
      <EmptyHint icon="activity" title="Loading workspace…" sub="Preparing the selected console area." />
    </div>
  );
}
