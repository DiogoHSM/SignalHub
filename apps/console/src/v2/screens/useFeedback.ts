import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type { FeedbackItem, FeedbackStatus, FeedbackWidgetSettings } from "../../api/types";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type FeedbackSettingsDraft = {
  enabled: boolean;
  title: string;
  prompt: string;
  placeholder: string;
  buttonLabel: string;
  accentColor: string;
  privacyNote: string;
};

export type FeedbackItemRowVM = {
  id: string;
  message: string;
  status: FeedbackStatus;
  pageLabel: string;
  submittedLabel: string;
  tenantId: string | null;
  userId: string | null;
  sessionId: string | null;
  traceId: string | null;
};

export type FeedbackVM = {
  settings: FeedbackSettingsDraft;
  items: FeedbackItemRowVM[];
  itemCount: number;
};

export type BuildFeedbackVMInput = {
  settings: FeedbackWidgetSettings;
  items: FeedbackItem[];
};

export type UseFeedbackResult = {
  data: FeedbackVM | null;
  status: "loading" | "ok" | "error" | "unavailable";
  busy: boolean;
  reload: () => void;
  saveSettings: (draft: FeedbackSettingsDraft) => Promise<boolean>;
  setStatus: (id: string, status: FeedbackStatus) => Promise<boolean>;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function relativeTimeFrom(iso: string, nowMs: number): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = nowMs - t;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ---------------------------------------------------------------------------
// Pure VM builder
// ---------------------------------------------------------------------------

export function buildFeedbackVM(input: BuildFeedbackVMInput, nowMs: number): FeedbackVM {
  const { settings, items } = input;

  const rows: FeedbackItemRowVM[] = items.map((item) => ({
    id: item.id,
    message: item.message,
    status: item.status,
    pageLabel: item.path ?? item.pageUrl ?? "unknown page",
    submittedLabel: relativeTimeFrom(item.submittedAt, nowMs),
    tenantId: item.tenantId,
    userId: item.userId,
    sessionId: item.sessionId,
    traceId: item.traceId,
  }));

  return {
    settings: {
      enabled: settings.enabled,
      title: settings.title,
      prompt: settings.prompt,
      placeholder: settings.placeholder,
      buttonLabel: settings.buttonLabel,
      accentColor: settings.accentColor,
      privacyNote: settings.privacyNote ?? "",
    },
    items: rows,
    itemCount: rows.length,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

type UseFeedbackArgs = {
  client: ApiClient;
  projectId: string | undefined;
  environmentId: string | undefined;
};

export function useFeedback({ client, projectId, environmentId }: UseFeedbackArgs): UseFeedbackResult {
  const [status, setStatusState] = useState<"loading" | "ok" | "error" | "unavailable">("loading");
  const [data, setData] = useState<FeedbackVM | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId || !environmentId) return;

    const getSettings = client.getFeedbackWidgetSettings;
    const listItems = client.listFeedbackItems;
    if (!getSettings || !listItems || !client.updateFeedbackWidgetSettings || !client.updateFeedbackStatus) {
      setStatusState("unavailable");
      setData(null);
      return;
    }

    const gen = ++genRef.current;
    const nowMs = Date.now();
    setStatusState("loading");

    Promise.all([
      getSettings({ projectId, environmentId }),
      listItems({ projectId, environmentId, limit: 25 }),
    ])
      .then(([settingsResponse, feedbackResponse]) => {
        if (gen !== genRef.current) return;
        setData(buildFeedbackVM({ settings: settingsResponse.settings, items: feedbackResponse.feedback }, nowMs));
        setStatusState("ok");
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setData(null);
        setStatusState("error");
      });

    return () => {
      ++genRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, projectId, environmentId, tick]);

  // Returns true on success, false on failure. The caller surfaces the
  // user-facing message via pushToast when this resolves false.
  const run = useCallback(
    async (fn: () => Promise<void>): Promise<boolean> => {
      setBusy(true);
      try {
        await fn();
        reload();
        return true;
      } catch (err) {
        console.error(err);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const saveSettings = useCallback(
    (draft: FeedbackSettingsDraft) =>
      run(async () => {
        if (!projectId || !environmentId || !client.updateFeedbackWidgetSettings) return;
        await client.updateFeedbackWidgetSettings({
          projectId,
          environmentId,
          enabled: draft.enabled,
          title: draft.title,
          prompt: draft.prompt,
          placeholder: draft.placeholder,
          buttonLabel: draft.buttonLabel,
          accentColor: draft.accentColor,
          allowScreenshot: false,
          privacyNote: draft.privacyNote || null,
        });
      }),
    [client, environmentId, projectId, run],
  );

  const setStatus = useCallback(
    (id: string, itemStatus: FeedbackStatus) =>
      run(async () => {
        if (!projectId || !environmentId || !client.updateFeedbackStatus) return;
        await client.updateFeedbackStatus(id, { projectId, environmentId }, itemStatus);
      }),
    [client, environmentId, projectId, run],
  );

  return {
    data,
    status,
    busy,
    reload,
    saveSettings,
    setStatus,
  };
}
