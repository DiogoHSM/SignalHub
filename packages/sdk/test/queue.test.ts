import { describe, expect, it } from "vitest";
import { createSignalQueue } from "../src/queue.js";
import type { QueuedSignal } from "../src/types.js";

const event = (name: string): QueuedSignal => ({
  kind: "event",
  endpointPath: "/v1/events",
  payload: { name, metadata: {}, properties: {} }
});

describe("createSignalQueue", () => {
  it("drains items in FIFO order and empties the queue", () => {
    const queue = createSignalQueue(3);
    const one = event("one");
    const two = event("two");
    const three = event("three");

    expect(queue.enqueue(one)).toEqual({ dropped: undefined });
    expect(queue.enqueue(two)).toEqual({ dropped: undefined });
    expect(queue.enqueue(three)).toEqual({ dropped: undefined });

    expect(queue.size()).toBe(3);
    expect(queue.drain()).toEqual([one, two, three]);
    expect(queue.size()).toBe(0);
    expect(queue.drain()).toEqual([]);
  });

  it("drops the oldest item and increments dropped count when max size is exceeded", () => {
    const queue = createSignalQueue(2);
    const one = event("one");
    const two = event("two");
    const three = event("three");

    queue.enqueue(one);
    queue.enqueue(two);

    expect(queue.enqueue(three)).toEqual({ dropped: one });
    expect(queue.dropped()).toBe(1);
    expect(queue.drain()).toEqual([two, three]);
  });

  it("restores retained items to the front without disturbing existing later items", () => {
    const queue = createSignalQueue(3);
    const one = event("one");
    const two = event("two");
    const three = event("three");

    queue.enqueue(three);
    queue.requeueFront([one, two]);

    expect(queue.drain()).toEqual([one, two, three]);
  });

  it("trims existing later items from the back when requeueFront exceeds max size", () => {
    const queue = createSignalQueue(2);
    const one = event("one");
    const two = event("two");
    const three = event("three");

    queue.enqueue(three);
    queue.requeueFront([one, two]);

    expect(queue.dropped()).toBe(1);
    expect(queue.drain()).toEqual([one, two]);
  });

  it("trims retained items from the back when requeueFront input exceeds max size", () => {
    const queue = createSignalQueue(2);
    const one = event("one");
    const two = event("two");
    const three = event("three");

    queue.requeueFront([one, two, three]);

    expect(queue.dropped()).toBe(1);
    expect(queue.drain()).toEqual([one, two]);
  });

  it("drops every enqueue and remains empty when max size is zero", () => {
    const queue = createSignalQueue(0);
    const one = event("one");
    const two = event("two");

    expect(queue.enqueue(one)).toEqual({ dropped: one });
    expect(queue.enqueue(two)).toEqual({ dropped: two });

    expect(queue.size()).toBe(0);
    expect(queue.dropped()).toBe(2);
    expect(queue.drain()).toEqual([]);
  });

  it("uses zero capacity for NaN max size", () => {
    const queue = createSignalQueue(Number.NaN);
    const one = event("one");

    expect(queue.enqueue(one)).toEqual({ dropped: one });
    expect(queue.size()).toBe(0);
    expect(queue.dropped()).toBe(1);
    expect(queue.drain()).toEqual([]);
  });

  it("returns and resets the dropped count", () => {
    const queue = createSignalQueue(2);

    queue.enqueue(event("one"));
    queue.enqueue(event("two"));
    queue.enqueue(event("three"));

    expect(queue.consumeDropped()).toBe(1);
    expect(queue.consumeDropped()).toBe(0);
    expect(queue.dropped()).toBe(0);
  });
});
