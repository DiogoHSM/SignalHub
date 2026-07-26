import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type { UserDetailQuery, UserDetailResponse, UserSignalType, UserWindow } from "../../api/types";

// ---------------------------------------------------------------------------
// Hook args / result
// ---------------------------------------------------------------------------

type UseUserDetailArgs = {
  client: { getUserDetail: ApiClient["getUserDetail"] };
  projectId: string;
  environmentId: string;
  /** null when no user is selected, or the collapsed anonymous key. Both are no-ops. */
  userId: string | null;
  window: UserWindow;
  tenantId?: string;
  signalType?: UserSignalType;
  limit?: number;
};

export type UseUserDetailResult = {
  data: UserDetailResponse | null;
  status: "loading" | "ok" | "error";
  loadingMore: boolean;
  loadMoreError: boolean;
  loadMore: () => void;
  reload: () => void;
};

const DETAIL_LIMIT = 50;

function isFetchable(userId: string | null): userId is string {
  return userId != null && userId !== "" && userId !== "_anonymous";
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useUserDetail({
  client,
  projectId,
  environmentId,
  userId,
  window: timeWindow,
  tenantId,
  signalType,
  limit = DETAIL_LIMIT,
}: UseUserDetailArgs): UseUserDetailResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [data, setData] = useState<UserDetailResponse | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    setLoadingMore(false);
    setLoadMoreError(false);

    // No selection, or the collapsed anonymous key (v1 rule) — never fetch.
    if (!projectId || !environmentId || !isFetchable(userId)) {
      ++genRef.current;
      setData(null);
      setStatus("ok");
      return;
    }

    const gen = ++genRef.current;
    setStatus("loading");
    setData(null);

    const query: UserDetailQuery = { projectId, environmentId, window: timeWindow, limit };
    if (tenantId) query.tenantId = tenantId;
    if (signalType) query.signalType = signalType;

    client
      .getUserDetail(userId, query)
      .then((res) => {
        if (gen !== genRef.current) return;
        setData(res.data);
        setStatus("ok");
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setData(null);
        setStatus("error");
      });

    return () => {
      ++genRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, environmentId, userId, timeWindow, tenantId, signalType, limit, tick]);

  const loadMore = useCallback(() => {
    if (!isFetchable(userId) || !data?.cursor || loadingMore) return;

    const gen = ++genRef.current;
    const cursor = data.cursor;
    setLoadingMore(true);
    setLoadMoreError(false);

    const query: UserDetailQuery = { projectId, environmentId, window: timeWindow, limit, cursor };
    if (tenantId) query.tenantId = tenantId;
    if (signalType) query.signalType = signalType;

    client
      .getUserDetail(userId, query)
      .then((res) => {
        if (gen !== genRef.current) return;
        setData((current) =>
          current ? { ...res.data, timeline: [...current.timeline, ...res.data.timeline] } : res.data
        );
        setLoadingMore(false);
        setLoadMoreError(false);
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setLoadingMore(false);
        setLoadMoreError(true);
      });
  }, [client, data, loadingMore, projectId, environmentId, timeWindow, tenantId, signalType, limit, userId]);

  return { data, status, loadingMore, loadMoreError, loadMore, reload };
}
