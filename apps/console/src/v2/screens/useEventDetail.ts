import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type { IncidentReplay, SessionTimelineItem, SessionTimelineResponse } from "../../api/types";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type ReplayDetailStatus = "idle" | "loading" | "ok" | "error";
export type SessionTimelineStatus = "idle" | "loading" | "ok" | "error";

export type SessionTimelineRowVM = {
  id: string;
  type: SessionTimelineItem["type"];
  timestamp: string;
  title: string;
  level: string | null;
  traceId: string | null;
};

export type UseEventDetailResult = {
  replay: IncidentReplay | null;
  replayStatus: ReplayDetailStatus;
  timeline: SessionTimelineRowVM[];
  timelineStatus: SessionTimelineStatus;
};

type UseEventDetailArgs = {
  client: {
    getSessionReplayDetail?: ApiClient["getSessionReplayDetail"];
    getSessionTimeline: ApiClient["getSessionTimeline"];
  };
  projectId: string | undefined;
  environmentId: string | undefined;
  event: { replayId: string | null; sessionId: string | null; timestamp: string } | undefined;
  beforeSeconds?: number;
  afterSeconds?: number;
  limit?: number;
};

const DEFAULT_BEFORE_SECONDS = 120;
const DEFAULT_AFTER_SECONDS = 120;
const DEFAULT_TIMELINE_LIMIT = 50;

export function buildSessionTimelineVM(response: SessionTimelineResponse): SessionTimelineRowVM[] {
  return response.items.map((item) => ({
    id: item.id,
    type: item.type,
    timestamp: item.timestamp,
    title: item.title,
    level: item.level,
    traceId: item.traceId,
  }));
}

// ---------------------------------------------------------------------------
// Hook — replay detail and session timeline load independently; one failing
// (or the client lacking the optional method) never blocks the other.
// ---------------------------------------------------------------------------

export function useEventDetail({
  client,
  projectId,
  environmentId,
  event,
  beforeSeconds = DEFAULT_BEFORE_SECONDS,
  afterSeconds = DEFAULT_AFTER_SECONDS,
  limit = DEFAULT_TIMELINE_LIMIT,
}: UseEventDetailArgs): UseEventDetailResult {
  const [replay, setReplay] = useState<IncidentReplay | null>(null);
  const [replayStatus, setReplayStatus] = useState<ReplayDetailStatus>("idle");
  const [timeline, setTimeline] = useState<SessionTimelineRowVM[]>([]);
  const [timelineStatus, setTimelineStatus] = useState<SessionTimelineStatus>("idle");
  const replayGenRef = useRef(0);
  const timelineGenRef = useRef(0);

  useEffect(() => {
    const gen = ++replayGenRef.current;

    if (!projectId || !environmentId || !event?.replayId) {
      setReplay(null);
      setReplayStatus("idle");
      return;
    }
    if (!client.getSessionReplayDetail) {
      setReplay(null);
      setReplayStatus("error");
      return;
    }

    setReplayStatus("loading");
    void client.getSessionReplayDetail(event.replayId, { projectId, environmentId }).then(
      ({ data }) => {
        if (gen !== replayGenRef.current) return;
        setReplay(data);
        setReplayStatus("ok");
      },
      () => {
        if (gen !== replayGenRef.current) return;
        setReplay(null);
        setReplayStatus("error");
      }
    );

    return () => {
      ++replayGenRef.current;
    };
  }, [client, projectId, environmentId, event?.replayId]);

  useEffect(() => {
    const gen = ++timelineGenRef.current;

    if (!projectId || !environmentId || !event?.sessionId) {
      setTimeline([]);
      setTimelineStatus("idle");
      return;
    }

    setTimelineStatus("loading");
    void client
      .getSessionTimeline(event.sessionId, {
        projectId,
        environmentId,
        center: event.timestamp,
        beforeSeconds,
        afterSeconds,
        limit,
      })
      .then(
        ({ data }) => {
          if (gen !== timelineGenRef.current) return;
          setTimeline(buildSessionTimelineVM(data));
          setTimelineStatus("ok");
        },
        () => {
          if (gen !== timelineGenRef.current) return;
          setTimeline([]);
          setTimelineStatus("error");
        }
      );

    return () => {
      ++timelineGenRef.current;
    };
  }, [client, projectId, environmentId, event?.sessionId, event?.timestamp, beforeSeconds, afterSeconds, limit]);

  return { replay, replayStatus, timeline, timelineStatus };
}
