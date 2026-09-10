"use client";

import { useCallback, useState } from "react";

export interface PendingAction {
  title: string;
  description: string;
  run: () => Promise<void>;
}

/**
 * Re-authentication gate for sensitive Cloud Development actions. Callers
 * `queue(title, description, run)` and render `<ReauthModal>` — the same
 * pattern as the rest of the Admin Console. The server still re-enforces the
 * 30-second window on every mutation; this only restores it in the UI.
 */
export function useElevatedAction(onSettled: () => void): {
  pending: PendingAction | null;
  queue: (title: string, description: string, run: () => Promise<void>) => void;
  cancel: () => void;
  onReauthenticated: () => void;
} {
  const [pending, setPending] = useState<PendingAction | null>(null);

  const queue = useCallback(
    (title: string, description: string, run: () => Promise<void>) => {
      setPending({ title, description, run });
    },
    []
  );
  const cancel = useCallback(() => setPending(null), []);
  const onReauthenticated = useCallback(() => {
    const action = pending;
    setPending(null);
    if (!action) return;
    void action.run().then(onSettled, onSettled);
  }, [pending, onSettled]);

  return { pending, queue, cancel, onReauthenticated };
}