import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../../../api/client";
import type {
  BetaProgram,
  BetaProgramActorType,
  BetaProgramAdoption,
  BetaProgramParticipant,
  BetaProgramStatus,
} from "../../../api/types";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type BetaProgramRowVM = {
  id: string;
  key: string;
  name: string;
  status: BetaProgramStatus;
  actorType: BetaProgramActorType;
  featureFlagId: string | null;
};

export type ParticipantRowVM = {
  id: string;
  actorId: string;
  status: BetaProgramParticipant["status"];
  notes: string;
};

export type SelectedBetaProgramVM = {
  id: string;
  status: BetaProgramStatus;
  actorType: BetaProgramActorType;
  participants: ParticipantRowVM[];
  participantsCount: number;
  activeParticipants: number;
  adoptionRateLabel: string;
};

export type BetaProgramsVM = {
  rows: BetaProgramRowVM[];
  selected: SelectedBetaProgramVM | null;
};

export type CreateBetaProgramForm = {
  key: string;
  name: string;
  featureFlagId: string;
};

function toRowVM(p: BetaProgram): BetaProgramRowVM {
  return { id: p.id, key: p.key, name: p.name, status: p.status, actorType: p.actorType, featureFlagId: p.featureFlagId };
}

export function buildBetaProgramsVM(
  rows: BetaProgram[],
  selectedId: string | undefined,
  participants: BetaProgramParticipant[],
  adoption: BetaProgramAdoption | null,
): BetaProgramsVM {
  const program = rows.find((p) => p.id === selectedId) ?? null;
  const selected: SelectedBetaProgramVM | null = program
    ? {
        id: program.id,
        status: program.status,
        actorType: program.actorType,
        participants: participants.map((p) => ({
          id: p.id,
          actorId: p.actorId,
          status: p.status,
          notes: p.notes ?? "none",
        })),
        participantsCount: adoption?.participants ?? participants.length,
        activeParticipants: adoption?.activeParticipants ?? participants.filter((p) => p.status === "active").length,
        adoptionRateLabel: `${(adoption?.adoptionRate ?? 0).toFixed(1)}%`,
      }
    : null;

  return { rows: rows.map(toRowVM), selected };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export type UseBetaProgramsResult = {
  data: BetaProgramsVM | null;
  status: "loading" | "ok" | "error";
  busy: boolean;
  reload: () => void;
  createProgram: (form: CreateBetaProgramForm) => Promise<boolean>;
  updateProgramStatus: (id: string, status: BetaProgramStatus) => Promise<boolean>;
  archiveProgram: (id: string) => Promise<boolean>;
  addParticipant: (actorId: string) => Promise<boolean>;
  removeParticipant: (participantId: string) => Promise<boolean>;
};

type UseBetaProgramsArgs = {
  client: Partial<
    Pick<
      ApiClient,
      | "listBetaPrograms"
      | "createBetaProgram"
      | "updateBetaProgram"
      | "archiveBetaProgram"
      | "listBetaProgramParticipants"
      | "addBetaProgramParticipant"
      | "removeBetaProgramParticipant"
      | "getBetaProgramAdoption"
    >
  >;
  projectId: string | undefined;
  environmentId: string | undefined;
  selectedId: string | undefined;
  enabled: boolean;
};

export function useBetaPrograms({ client, projectId, environmentId, selectedId, enabled }: UseBetaProgramsArgs): UseBetaProgramsResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [rows, setRows] = useState<BetaProgram[]>([]);
  const [participants, setParticipants] = useState<BetaProgramParticipant[]>([]);
  const [adoption, setAdoption] = useState<BetaProgramAdoption | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId || !environmentId || !enabled) return;

    if (!client.listBetaPrograms) {
      setStatus("error");
      setRows([]);
      return;
    }

    const gen = ++genRef.current;
    setStatus("loading");

    client
      .listBetaPrograms({ projectId, environmentId })
      .then(({ programs }) => {
        if (gen !== genRef.current) return;
        setRows(programs);
        setStatus("ok");
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setRows([]);
        setStatus("error");
      });

    return () => {
      ++genRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, projectId, environmentId, enabled, tick]);

  useEffect(() => {
    const program = rows.find((p) => p.id === selectedId) ?? null;
    if (!projectId || !environmentId || !program) {
      setParticipants([]);
      setAdoption(null);
      return;
    }
    let cancelled = false;
    Promise.all([
      client.listBetaProgramParticipants
        ? client.listBetaProgramParticipants(program.id, { projectId, environmentId }).catch(() => null)
        : Promise.resolve(null),
      client.getBetaProgramAdoption
        ? client.getBetaProgramAdoption(program.id, { projectId, environmentId, window: "30d" }).catch(() => null)
        : Promise.resolve(null),
    ]).then(([participantsRes, adoptionRes]) => {
      if (cancelled) return;
      setParticipants(participantsRes?.participants ?? []);
      setAdoption(adoptionRes?.adoption ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [client, projectId, environmentId, selectedId, rows]);

  const data = useMemo<BetaProgramsVM | null>(() => {
    if (status !== "ok") return null;
    return buildBetaProgramsVM(rows, selectedId, participants, adoption);
  }, [status, rows, selectedId, participants, adoption]);

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

  const createProgram = useCallback(
    (form: CreateBetaProgramForm) =>
      run(async () => {
        if (!projectId || !environmentId || !client.createBetaProgram) return;
        await client.createBetaProgram({
          projectId,
          environmentId,
          key: form.key,
          name: form.name,
          status: "active",
          actorType: "user",
          featureFlagId: form.featureFlagId || null,
          featureFlagVariant: "on",
        });
      }),
    [client, environmentId, projectId, run],
  );

  const updateProgramStatus = useCallback(
    (id: string, nextStatus: BetaProgramStatus) =>
      run(async () => {
        if (!projectId || !environmentId || !client.updateBetaProgram) return;
        await client.updateBetaProgram(id, { projectId, environmentId }, { status: nextStatus });
      }),
    [client, environmentId, projectId, run],
  );

  const archiveProgram = useCallback(
    (id: string) =>
      run(async () => {
        if (!projectId || !environmentId || !client.archiveBetaProgram) return;
        await client.archiveBetaProgram(id, { projectId, environmentId });
      }),
    [client, environmentId, projectId, run],
  );

  const addParticipant = useCallback(
    (actorId: string) =>
      run(async () => {
        const program = rows.find((p) => p.id === selectedId);
        if (!projectId || !environmentId || !program || !client.addBetaProgramParticipant) return;
        await client.addBetaProgramParticipant(program.id, {
          projectId,
          environmentId,
          actorType: program.actorType,
          actorId,
          status: "active",
        });
      }),
    [client, environmentId, projectId, rows, selectedId, run],
  );

  const removeParticipant = useCallback(
    (participantId: string) =>
      run(async () => {
        if (!projectId || !environmentId || !selectedId || !client.removeBetaProgramParticipant) return;
        await client.removeBetaProgramParticipant(selectedId, participantId, { projectId, environmentId });
      }),
    [client, environmentId, projectId, selectedId, run],
  );

  return {
    data,
    status,
    busy,
    reload,
    createProgram,
    updateProgramStatus,
    archiveProgram,
    addParticipant,
    removeParticipant,
  };
}
