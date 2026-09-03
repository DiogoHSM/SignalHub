export type JsonBounds = {
  maxDepth: number;
  maxNodes: number;
  maxKeys: number;
  maxArrayLength: number;
};

export type JsonBoundsViolation = "depth" | "nodes" | "keys" | "array_length" | "cycle";

export type JsonBoundsResult =
  | { ok: true }
  | { ok: false; violation: JsonBoundsViolation; path: Array<string | number> };

export const generalTelemetryJsonBounds: JsonBounds = {
  maxDepth: 8,
  maxNodes: 2_048,
  maxKeys: 512,
  maxArrayLength: 512
};

type PendingValue = {
  value: unknown;
  depth: number;
  path: Array<string | number>;
  phase: "enter" | "exit";
};

export function inspectJsonBounds(value: unknown, bounds: JsonBounds): JsonBoundsResult {
  const pending: PendingValue[] = [{ value, depth: 0, path: [], phase: "enter" }];
  const active = new WeakSet<object>();
  const completed = new WeakSet<object>();
  let nodes = 0;
  let keys = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;

    if (current.phase === "exit") {
      if (current.value !== null && typeof current.value === "object") {
        active.delete(current.value);
        completed.add(current.value);
      }
      continue;
    }

    nodes += 1;
    if (nodes > bounds.maxNodes) {
      return { ok: false, violation: "nodes", path: current.path };
    }

    if (current.value === null || typeof current.value !== "object") continue;
    const objectValue = current.value;

    if (active.has(objectValue)) {
      return { ok: false, violation: "cycle", path: current.path };
    }
    if (completed.has(objectValue)) continue;

    const containerDepth = current.depth + 1;
    if (containerDepth > bounds.maxDepth) {
      return { ok: false, violation: "depth", path: current.path };
    }

    active.add(objectValue);
    pending.push({ ...current, depth: containerDepth, phase: "exit" });

    if (Array.isArray(objectValue)) {
      if (objectValue.length > bounds.maxArrayLength) {
        return { ok: false, violation: "array_length", path: current.path };
      }
      for (let index = objectValue.length - 1; index >= 0; index -= 1) {
        if (!(index in objectValue)) continue;
        pending.push({
          value: objectValue[index],
          depth: containerDepth,
          path: [...current.path, index],
          phase: "enter"
        });
      }
      continue;
    }

    const entries = Object.entries(objectValue);
    keys += entries.length;
    if (keys > bounds.maxKeys) {
      return { ok: false, violation: "keys", path: current.path };
    }
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, nestedValue] = entries[index]!;
      pending.push({
        value: nestedValue,
        depth: containerDepth,
        path: [...current.path, key],
        phase: "enter"
      });
    }
  }

  return { ok: true };
}
