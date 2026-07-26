// ---------------------------------------------------------------------------
// runMutation — the one place a console v2 mutation is allowed to fail
// silently is nowhere. Every call site that used to do `void someMutation()`
// with no error handling should wrap the call in this helper instead.
// ---------------------------------------------------------------------------
//
// Two mutation shapes exist across the v2 hooks:
//  - "throwing" mutations (e.g. useIncident's resolve/setPriority/setStatus/
//    reassign/silence/addNote): reject on failure, otherwise resolve void.
//  - "boolean" mutations (the `run()` pattern used by useAlerts/useArtifacts/
//    useFeedback/useMonitors/useSegments): never reject, resolve `false` on
//    failure instead.
//
// runMutation accepts either shape and normalizes both into a single
// contract: `true` on success (no toast), `false` on failure (toast pushed
// with `message`, error logged). Callers keep owning what happens on success
// (reload, closing a menu, clearing a field) — this helper never does that
// for them, so "reload only on success" semantics are unaffected.

export type RunMutationOptions = {
  pushToast: (message: string) => void;
  message: string;
};

export async function runMutation(
  fn: () => Promise<boolean | void>,
  { pushToast, message }: RunMutationOptions
): Promise<boolean> {
  try {
    const result = await fn();
    if (result === false) {
      pushToast(message);
      return false;
    }
    return true;
  } catch (err) {
    console.error(err);
    pushToast(message);
    return false;
  }
}
