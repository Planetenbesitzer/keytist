import { debounce, throttle} from 'lodash'
import { useSnapshotStore } from '@/store'
import { getSnapshotHistoryEpoch } from '@/store/snapshot'
import { registerPendingHistorySnapshot, unregisterPendingHistorySnapshot } from '@/utils/historySnapshots'

export default () => {
  const snapshotStore = useSnapshotStore()

  // 添加历史快照(历史记录)
  const addSnapshotDebounced = debounce(function(epoch: number) {
    unregisterPendingHistorySnapshot(flushHistorySnapshot)
    if (epoch === getSnapshotHistoryEpoch()) return snapshotStore.addSnapshot()
  }, 300, { trailing: true })
  const flushHistorySnapshot = () => addSnapshotDebounced.flush()
  const addHistorySnapshot = () => {
    registerPendingHistorySnapshot(flushHistorySnapshot)
    return addSnapshotDebounced(getSnapshotHistoryEpoch())
  }

  // 重做
  const redo = throttle(function() {
    snapshotStore.reDo()
  }, 100, { leading: true, trailing: false })

  // 撤销
  const undo = throttle(function() {
    snapshotStore.unDo()
  }, 100, { leading: true, trailing: false })

  return {
    addHistorySnapshot,
    flushHistorySnapshot,
    redo,
    undo,
  }
}
