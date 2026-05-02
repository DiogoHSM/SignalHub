import type { QueuedSignal } from "./types.js";

export type SignalQueue = {
  enqueue: (item: QueuedSignal) => { dropped?: QueuedSignal };
  drain: () => QueuedSignal[];
  requeueFront: (items: QueuedSignal[]) => void;
  size: () => number;
  dropped: () => number;
  consumeDropped: () => number;
};

export function createSignalQueue(maxSize: number): SignalQueue {
  const capacity = Number.isFinite(maxSize) ? Math.max(0, Math.floor(maxSize)) : 0;
  const items: QueuedSignal[] = [];
  let droppedCount = 0;

  const trimBack = () => {
    while (items.length > capacity) {
      items.pop();
      droppedCount += 1;
    }
  };

  return {
    enqueue(item) {
      let dropped: QueuedSignal | undefined;

      if (capacity <= 0) {
        droppedCount += 1;
        return { dropped: item };
      }

      if (items.length >= capacity) {
        dropped = items.shift();
        droppedCount += 1;
      }

      items.push(item);

      return { dropped };
    },

    drain() {
      return items.splice(0, items.length);
    },

    requeueFront(retainedItems) {
      items.unshift(...retainedItems);
      trimBack();
    },

    size() {
      return items.length;
    },

    dropped() {
      return droppedCount;
    },

    consumeDropped() {
      const count = droppedCount;
      droppedCount = 0;
      return count;
    }
  };
}
