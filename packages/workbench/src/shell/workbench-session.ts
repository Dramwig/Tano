interface Session {
  users: number;
  startup?: Promise<void>;
  dispose: () => void;
}

const sessions = new WeakMap<object, Session>();

/** A Vue hot reload replaces the view synchronously but retains its Pinia stores. */
export function retainWorkbenchSession(owner: object, dispose: () => void) {
  let session = sessions.get(owner);
  if (!session) {
    session = { users: 0, dispose };
    sessions.set(owner, session);
  }
  const current = session;
  current.users++;
  current.dispose = dispose;
  let released = false;
  return {
    initialize(start: () => Promise<void>) {
      // Reopening storage on a view remount would discard the live draft/session.
      return current.startup ??= Promise.resolve().then(start);
    },
    release() {
      if (released) return;
      released = true;
      current.users--;
      queueMicrotask(() => {
        if (current.users || sessions.get(owner) !== current) return;
        sessions.delete(owner);
        current.dispose();
      });
    },
  };
}
