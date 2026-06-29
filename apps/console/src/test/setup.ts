import * as matchers from "@testing-library/jest-dom/matchers";
import { expect } from "vitest";

expect.extend(matchers);

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, String(value));
    }
  };
}

function needsStoragePolyfill(name: "localStorage" | "sessionStorage") {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  return !descriptor || typeof descriptor.get === "function";
}

if (needsStoragePolyfill("localStorage")) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: createMemoryStorage()
  });
}

if (needsStoragePolyfill("sessionStorage")) {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: createMemoryStorage()
  });
}
