import type {
  SignalContext,
  SignalMetadata,
  SignalMonitorClient,
  WebVitalInput,
  WebVitalName,
  WebVitalRating
} from "./types.js";

export type StopBrowserWebVitals = () => void;

export type BrowserWebVitalsOptions = {
  metrics?: WebVitalName[];
  route?: string | (() => string | undefined);
  context?: SignalContext;
  metadata?: SignalMetadata | ((metric: WebVitalInput) => SignalMetadata);
  flush?: boolean;
  reportAllChanges?: boolean;
  sampleRate?: number;
};

type PerformanceObserverEntryLike = {
  entryType?: string;
  name?: string;
  startTime?: number;
  value?: number;
  hadRecentInput?: boolean;
  duration?: number;
  responseStart?: number;
};

type PerformanceObserverListLike = {
  getEntries: () => PerformanceObserverEntryLike[];
};

type PerformanceObserverLike = {
  observe: (options: { type?: string; entryTypes?: string[]; buffered?: boolean; durationThreshold?: number }) => void;
  disconnect?: () => void;
};

type PerformanceObserverConstructorLike = {
  new (callback: (list: PerformanceObserverListLike) => void): PerformanceObserverLike;
};

const DEFAULT_METRICS: WebVitalName[] = ["CLS", "FCP", "FID", "INP", "LCP", "TTFB"];

export function installBrowserWebVitals(
  client: SignalMonitorClient,
  options: BrowserWebVitalsOptions = {}
): StopBrowserWebVitals {
  const observerConstructor = getPerformanceObserver();
  if (!observerConstructor || !shouldSample(options.sampleRate)) {
    return () => undefined;
  }

  const metrics = new Set(options.metrics ?? DEFAULT_METRICS);
  const observers: PerformanceObserverLike[] = [];
  let stopped = false;
  let cumulativeCls = 0;

  const report = (input: WebVitalInput): void => {
    if (stopped || !metrics.has(input.name)) {
      return;
    }

    const metadata = typeof options.metadata === "function" ? options.metadata(input) : options.metadata;
    client.webVital(
      {
        ...input,
        route: input.route ?? resolveRoute(options.route),
        metadata
      },
      options.context
    );

    if (options.flush === true) {
      void client.flush().catch(() => undefined);
    }
  };

  const addObserver = (
    type: string,
    callback: (entry: PerformanceObserverEntryLike) => void,
    observeOptions: { buffered?: boolean; durationThreshold?: number } = { buffered: true }
  ): void => {
    try {
      const observer = new observerConstructor((list) => {
        for (const entry of list.getEntries()) {
          callback(entry);
        }
      });
      observer.observe({ type, ...observeOptions });
      observers.push(observer);
    } catch {
      // Some browsers do not support every PerformanceObserver entry type.
    }
  };

  addObserver("paint", (entry) => {
    if (entry.name !== "first-contentful-paint" || entry.startTime === undefined) return;
    report({ name: "FCP", value: entry.startTime, rating: rateFcp(entry.startTime) });
  });

  addObserver("largest-contentful-paint", (entry) => {
    if (entry.startTime === undefined) return;
    report({ name: "LCP", value: entry.startTime, rating: rateLcp(entry.startTime) });
  });

  addObserver("layout-shift", (entry) => {
    if (entry.hadRecentInput || entry.value === undefined) return;
    cumulativeCls += entry.value;
    report({ name: "CLS", value: roundMetric(cumulativeCls), rating: rateCls(cumulativeCls) });
  });

  addObserver("first-input", (entry) => {
    const value = entry.duration ?? entry.startTime;
    if (value === undefined) return;
    report({ name: "FID", value, rating: rateFid(value) });
  });

  addObserver("event", (entry) => {
    if (entry.duration === undefined) return;
    report({ name: "INP", value: entry.duration, rating: rateInp(entry.duration) });
  }, { buffered: true, durationThreshold: 40 });

  addObserver("navigation", (entry) => {
    const value = entry.responseStart ?? entry.startTime;
    if (value === undefined) return;
    report({ name: "TTFB", value, rating: rateTtfb(value), navigationType: entry.name });
  });

  return () => {
    stopped = true;
    for (const observer of observers) {
      observer.disconnect?.();
    }
  };
}

function getPerformanceObserver(): PerformanceObserverConstructorLike | undefined {
  const runtime = globalThis as typeof globalThis & { PerformanceObserver?: PerformanceObserverConstructorLike };
  return runtime.PerformanceObserver;
}

function resolveRoute(route: BrowserWebVitalsOptions["route"]): string | undefined {
  if (typeof route === "function") return route();
  if (typeof route === "string") return route;
  const runtime = globalThis as typeof globalThis & { location?: { pathname?: string } };
  return runtime.location?.pathname;
}

function shouldSample(sampleRate: number | undefined): boolean {
  if (sampleRate === undefined) return true;
  if (sampleRate <= 0) return false;
  if (sampleRate >= 1) return true;
  return Math.random() < sampleRate;
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function rateThreshold(value: number, good: number, poor: number): WebVitalRating {
  if (value <= good) return "good";
  if (value <= poor) return "needs-improvement";
  return "poor";
}

function rateCls(value: number): WebVitalRating {
  return rateThreshold(value, 0.1, 0.25);
}

function rateFcp(value: number): WebVitalRating {
  return rateThreshold(value, 1800, 3000);
}

function rateFid(value: number): WebVitalRating {
  return rateThreshold(value, 100, 300);
}

function rateInp(value: number): WebVitalRating {
  return rateThreshold(value, 200, 500);
}

function rateLcp(value: number): WebVitalRating {
  return rateThreshold(value, 2500, 4000);
}

function rateTtfb(value: number): WebVitalRating {
  return rateThreshold(value, 800, 1800);
}
