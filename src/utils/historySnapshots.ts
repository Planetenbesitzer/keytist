type PendingSnapshotFlush = () => Promise<unknown> | unknown
const pendingSnapshots = new Set<PendingSnapshotFlush>()

export const registerPendingHistorySnapshot = (flush: PendingSnapshotFlush) => pendingSnapshots.add(flush)
export const unregisterPendingHistorySnapshot = (flush: PendingSnapshotFlush) => pendingSnapshots.delete(flush)

/** Preserve in-flight typing as the previous undo step before an atomic action. */
export const flushPendingHistorySnapshots = async () => {
  await Promise.all([...pendingSnapshots].map(flush => flush()))
}
