import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type {
  AnalyticsSegment,
  AnalyticsSegmentActorType,
  AnalyticsSegmentDefinition,
  AnalyticsSegmentPreview,
  ApmWindow,
} from "../../api/types";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type SegmentRowVM = {
  id: string;
  name: string;
  actorType: AnalyticsSegmentActorType;
  summary: string;
  definition: AnalyticsSegmentDefinition;
  previewActors: number | null;
};

export type SegmentsVM = {
  rows: SegmentRowVM[];
};

export type SaveSegmentForm = {
  editingId?: string | null;
  name: string;
  actorType: AnalyticsSegmentActorType;
  window: ApmWindow;
  eventName: string;
  propertyName: string;
  propertyValue: string;
};

export type UseSegmentsResult = {
  data: SegmentsVM | null;
  status: "loading" | "ok" | "error";
  busy: boolean;
  reload: () => void;
  save: (form: SaveSegmentForm) => Promise<boolean>;
  archive: (id: string) => Promise<boolean>;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Name is required, and at least one of eventName/propertyName must be set — same rule as the v1 SegmentManager. */
export function validateSegmentForm(form: SaveSegmentForm): string | null {
  const name = form.name.trim();
  const eventName = form.eventName.trim();
  const propertyName = form.propertyName.trim();
  if (!name || (!eventName && !propertyName)) {
    return "Name and at least one event or property condition are required.";
  }
  return null;
}

function summarize(segment: AnalyticsSegment): string {
  const parts = [`${segment.actorType}s`, segment.definition.window ?? "30d", segment.definition.eventName ?? "any event"];
  if (segment.definition.propertyName) {
    parts.push(
      segment.definition.propertyValue
        ? `${segment.definition.propertyName} = ${segment.definition.propertyValue}`
        : `${segment.definition.propertyName} is present`
    );
  }
  return parts.join(" · ");
}

export function buildSegmentsVM(
  segments: AnalyticsSegment[],
  previews: Record<string, AnalyticsSegmentPreview>
): SegmentsVM {
  return {
    rows: segments.map((segment) => ({
      id: segment.id,
      name: segment.name,
      actorType: segment.actorType,
      summary: summarize(segment),
      definition: segment.definition,
      previewActors: previews[segment.id]?.actors ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

type UseSegmentsArgs = {
  client: Pick<
    ApiClient,
    "listAnalyticsSegments" | "createAnalyticsSegment" | "updateAnalyticsSegment" | "archiveAnalyticsSegment" | "previewAnalyticsSegment"
  >;
  projectId: string | undefined;
  environmentId: string | undefined;
};

const PREVIEW_LIMIT = 3;

export function useSegments({ client, projectId, environmentId }: UseSegmentsArgs): UseSegmentsResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [data, setData] = useState<SegmentsVM | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId || !environmentId) return;
    if (!client.listAnalyticsSegments) {
      setData(null);
      setStatus("error");
      return;
    }

    const gen = ++genRef.current;
    setStatus("loading");

    void client.listAnalyticsSegments({ projectId, environmentId }).then(
      ({ segments }) => {
        if (gen !== genRef.current) return;
        if (segments.length === 0 || !client.previewAnalyticsSegment) {
          setData(buildSegmentsVM(segments, {}));
          setStatus("ok");
          return;
        }
        void Promise.all(
          segments.map((segment) =>
            client
              .previewAnalyticsSegment!(segment.id, { projectId, environmentId, limit: PREVIEW_LIMIT })
              .then(({ preview }) => [segment.id, preview] as const)
              .catch(() => null)
          )
        ).then((entries) => {
          if (gen !== genRef.current) return;
          const previews = Object.fromEntries(
            entries.filter((entry): entry is readonly [string, AnalyticsSegmentPreview] => entry !== null)
          );
          setData(buildSegmentsVM(segments, previews));
          setStatus("ok");
        });
      },
      () => {
        if (gen !== genRef.current) return;
        setData(null);
        setStatus("error");
      }
    );

    return () => {
      ++genRef.current;
    };
  }, [client, projectId, environmentId, tick]);

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
    [reload]
  );

  const save = useCallback(
    (form: SaveSegmentForm) =>
      run(async () => {
        if (!projectId || !environmentId) return;
        const error = validateSegmentForm(form);
        if (error) throw new Error(error);

        const eventName = form.eventName.trim();
        const propertyName = form.propertyName.trim();
        const propertyValue = form.propertyValue.trim();
        const definition: AnalyticsSegmentDefinition = {
          window: form.window,
          ...(eventName ? { eventName } : {}),
          ...(propertyName ? { propertyName } : {}),
          ...(propertyValue ? { propertyValue } : {}),
        };

        if (form.editingId) {
          if (!client.updateAnalyticsSegment) throw new Error("updateAnalyticsSegment unavailable");
          await client.updateAnalyticsSegment(form.editingId, { name: form.name.trim(), actorType: form.actorType, definition });
        } else {
          if (!client.createAnalyticsSegment) throw new Error("createAnalyticsSegment unavailable");
          await client.createAnalyticsSegment({
            projectId,
            environmentId,
            name: form.name.trim(),
            actorType: form.actorType,
            definition,
          });
        }
      }),
    [client, environmentId, projectId, run]
  );

  const archive = useCallback(
    (id: string) =>
      run(async () => {
        if (!client.archiveAnalyticsSegment) throw new Error("archiveAnalyticsSegment unavailable");
        await client.archiveAnalyticsSegment(id);
      }),
    [client, run]
  );

  return { data, status, busy, reload, save, archive };
}
