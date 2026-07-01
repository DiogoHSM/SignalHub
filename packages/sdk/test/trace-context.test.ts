import { describe, expect, it } from "vitest";
import { createTraceContext, parseTraceparent, traceContextHeaders } from "../src/trace-context.js";

describe("trace context helpers", () => {
  it("creates W3C traceparent headers", () => {
    const context = createTraceContext("4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7");

    expect(context).toEqual({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    });
    expect(traceContextHeaders(context)).toEqual({ traceparent: context.traceparent });
  });

  it("parses valid traceparent and rejects invalid values", () => {
    expect(parseTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")).toEqual({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    });
    expect(parseTraceparent("00-00000000000000000000000000000000-00f067aa0ba902b7-01")).toBeUndefined();
    expect(parseTraceparent("not-a-traceparent")).toBeUndefined();
  });
});
