import { describe, expect, it, vi } from "vitest";
import { createSignalMonitorClient } from "../src/client.js";
import {
  buildNextContext,
  createSignalMonitorNextClient,
  installBrowserErrorCapture,
  withSignalMonitorAction,
  withSignalMonitorRoute
} from "../src/next.js";

describe("Next.js SDK wrapper", () => {
  it("builds safe request context from request-like input", () => {
    const request = new Request("https://app.example.com/api/orders?secret=hidden", {
      method: "POST",
      headers: { "x-request-id": "req_123" }
    });

    expect(buildNextContext({ request, routeName: "POST /api/orders", module: "orders" })).toEqual({
      traceId: "req_123",
      source: "POST /api/orders",
      metadata: {
        correlation_id: "req_123",
        module: "orders",
        request_method: "POST",
        request_path: "/api/orders",
        route_name: "POST /api/orders"
      }
    });
  });

  it("prefers W3C traceparent over request id headers", () => {
    const request = new Request("https://app.example.com/api/orders", {
      method: "GET",
      headers: {
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        "x-request-id": "req_123"
      }
    });

    expect(buildNextContext({ request, routeName: "GET /api/orders" })).toEqual({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      source: "GET /api/orders",
      metadata: {
        correlation_id: "4bf92f3577b34da6a3ce929d0e0e4736",
        parent_span_id: "00f067aa0ba902b7",
        request_method: "GET",
        request_path: "/api/orders",
        route_name: "GET /api/orders",
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
      }
    });
  });

  it("captures and flushes route handler errors with merged request context", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status: 202 });
    });
    const client = createSignalMonitorNextClient({
      endpoint: "https://sigmon.example.com",
      apiKey: "sh_test",
      fetch: fetchImpl,
      defaultContext: { release: "web@1" }
    });
    const handler = withSignalMonitorRoute(
      async () => {
        throw new Error("route exploded");
      },
      {
        client,
        routeName: "GET /api/orders",
        getContext: () => ({ tenantId: "tenant_1", userId: "user_1" })
      }
    );

    await expect(handler(new Request("https://app.example.com/api/orders"))).rejects.toThrow("route exploded");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://sigmon.example.com/v1/errors");
    expect(calls[0].body).toMatchObject({
      message: "route exploded",
      release: "web@1",
      tenant_id: "tenant_1",
      user_id: "user_1",
      source: "GET /api/orders",
      context: {
        route_name: "GET /api/orders"
      }
    });
  });

  it("passes route handler arguments to getContext", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status: 202 });
    });
    const client = createSignalMonitorNextClient({
      endpoint: "https://sigmon.example.com",
      apiKey: "sh_test",
      fetch: fetchImpl
    });
    const getContext = vi.fn((_request: Request, context: { params: { tenantId: string } }) => ({
      tenantId: context.params.tenantId,
      metadata: { tenant_source: "route_params" }
    }));
    const handler = withSignalMonitorRoute(
      async (_request: Request, _context: { params: { tenantId: string } }) => {
        throw new Error("route exploded");
      },
      {
        client,
        routeName: "GET /api/[tenantId]/orders",
        getContext
      }
    );
    const request = new Request("https://app.example.com/api/tenant_1/orders");
    const routeContext = { params: { tenantId: "tenant_1" } };

    await expect(handler(request, routeContext)).rejects.toThrow("route exploded");

    expect(getContext).toHaveBeenCalledWith(request, routeContext);
    expect(calls[0].body).toMatchObject({
      message: "route exploded",
      tenant_id: "tenant_1",
      context: {
        route_name: "GET /api/[tenantId]/orders",
        tenant_source: "route_params"
      }
    });
  });

  it("wraps server actions without changing successful return values", async () => {
    const client = createSignalMonitorNextClient({
      endpoint: "https://sigmon.example.com",
      apiKey: "sh_test",
      fetch: vi.fn()
    });
    const action = withSignalMonitorAction(async (value: number) => value * 2, {
      client,
      name: "createOrder"
    });

    await expect(action(21)).resolves.toBe(42);
  });

  it("passes action arguments to getContext and maps action names to context", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status: 202 });
    });
    const client = createSignalMonitorNextClient({
      endpoint: "https://sigmon.example.com",
      apiKey: "sh_test",
      fetch: fetchImpl
    });
    const getContext = vi.fn((orderId: string, quantity: number) => ({
      tenantId: "tenant_1",
      metadata: { order_id: orderId, quantity }
    }));
    const action = withSignalMonitorAction(
      async (_orderId: string, _quantity: number) => {
        throw new Error("action exploded");
      },
      {
        client,
        name: "createOrder",
        getContext
      }
    );

    await expect(action("order_1", 2)).rejects.toThrow("action exploded");

    expect(getContext).toHaveBeenCalledWith("order_1", 2);
    expect(calls[0].body).toMatchObject({
      message: "action exploded",
      tenant_id: "tenant_1",
      source: "createOrder",
      context: {
        route_name: "createOrder",
        order_id: "order_1",
        quantity: 2
      }
    });
  });

  it("does not mask route errors when getContext rejects", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status: 202 });
    });
    const client = createSignalMonitorNextClient({
      endpoint: "https://sigmon.example.com",
      apiKey: "sh_test",
      fetch: fetchImpl
    });
    const handler = withSignalMonitorRoute(
      async () => {
        throw new Error("route exploded");
      },
      {
        client,
        routeName: "GET /api/orders",
        getContext: async () => {
          throw new Error("context exploded");
        }
      }
    );

    await expect(handler(new Request("https://app.example.com/api/orders"))).rejects.toThrow("route exploded");

    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({
      message: "route exploded",
      source: "GET /api/orders",
      context: {
        route_name: "GET /api/orders"
      }
    });
  });

  it("does not mask action errors when getContext rejects", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status: 202 });
    });
    const client = createSignalMonitorNextClient({
      endpoint: "https://sigmon.example.com",
      apiKey: "sh_test",
      fetch: fetchImpl
    });
    const action = withSignalMonitorAction(
      async () => {
        throw new Error("action exploded");
      },
      {
        client,
        name: "createOrder",
        getContext: async () => {
          throw new Error("context exploded");
        }
      }
    );

    await expect(action()).rejects.toThrow("action exploded");

    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({
      message: "action exploded",
      source: "createOrder",
      context: {
        route_name: "createOrder"
      }
    });
  });

  it("installs and removes browser error listeners explicitly", () => {
    const listeners: Record<string, EventListenerOrEventListenerObject> = {};
    const addEventListenerMock = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      listeners[type] = listener;
    });
    const removeEventListenerMock = vi.fn();

    vi.stubGlobal("addEventListener", addEventListenerMock);
    vi.stubGlobal("removeEventListener", removeEventListenerMock);

    try {
      const client = createSignalMonitorNextClient({
        endpoint: "https://sigmon.example.com",
        apiKey: "sh_test",
        fetch: vi.fn(async () => new Response("{}", { status: 202 }))
      });

      const stop = installBrowserErrorCapture(client, { captureErrors: true, captureUnhandledRejections: true });

      expect(addEventListenerMock).toHaveBeenCalledWith("error", expect.any(Function));
      expect(addEventListenerMock).toHaveBeenCalledWith("unhandledrejection", expect.any(Function));

      stop();

      expect(removeEventListenerMock).toHaveBeenCalledWith("error", listeners.error);
      expect(removeEventListenerMock).toHaveBeenCalledWith("unhandledrejection", listeners.unhandledrejection);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("captures browser errors with a base client and only flushes when requested", async () => {
    const listeners: Record<string, EventListenerOrEventListenerObject> = {};
    const addEventListenerMock = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      listeners[type] = listener;
    });
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 202 }));

    vi.stubGlobal("addEventListener", addEventListenerMock);
    vi.stubGlobal("removeEventListener", vi.fn());

    try {
      const client = createSignalMonitorClient({
        endpoint: "https://sigmon.example.com",
        apiKey: "sh_test",
        fetch: fetchImpl
      });
      const stop = installBrowserErrorCapture(client, { captureUnhandledRejections: false });

      (listeners.error as EventListener)({ error: new Error("browser exploded") } as unknown as Event);
      await Promise.resolve();

      expect(fetchImpl).not.toHaveBeenCalled();

      stop();

      installBrowserErrorCapture(client, { captureUnhandledRejections: false, flush: true });
      (listeners.error as EventListener)({ error: new Error("flushed browser exploded") } as unknown as Event);

      await vi.waitFor(() => {
        expect(fetchImpl).toHaveBeenCalledTimes(1);
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("captures browser event diagnostics while preserving configured context", async () => {
    const listeners: Record<string, EventListenerOrEventListenerObject> = {};
    const addEventListenerMock = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      listeners[type] = listener;
    });
    const calls: Array<{ body: unknown }> = [];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status: 202 });
    });

    vi.stubGlobal("addEventListener", addEventListenerMock);
    vi.stubGlobal("removeEventListener", vi.fn());

    try {
      const client = createSignalMonitorClient({
        endpoint: "https://sigmon.example.com",
        apiKey: "sh_test",
        fetch: fetchImpl
      });
      const stop = installBrowserErrorCapture(client, {
        flush: true,
        context: {
          metadata: { component: "browser" },
          context: { session_id: "session_1" }
        }
      });

      (listeners.error as EventListener)({
        error: new Error("browser exploded"),
        message: "Script failed",
        filename: "https://app.example.com/app.js",
        lineno: 12,
        colno: 34
      } as unknown as Event);

      await vi.waitFor(() => {
        expect(fetchImpl).toHaveBeenCalledTimes(1);
      });

      (listeners.unhandledrejection as EventListener)({
        reason: new Error("promise exploded")
      } as unknown as Event);

      await vi.waitFor(() => {
        expect(fetchImpl).toHaveBeenCalledTimes(2);
      });

      expect(calls[0].body).toMatchObject({
        message: "browser exploded",
        source: "browser",
        context: {
          mechanism: "browser.error",
          handled: false,
          component: "browser",
          session_id: "session_1",
          message: "Script failed",
          filename: "https://app.example.com/app.js",
          lineno: 12,
          colno: 34
        }
      });
      expect(calls[1].body).toMatchObject({
        message: "promise exploded",
        source: "browser",
        context: {
          mechanism: "browser.unhandledrejection",
          handled: false,
          component: "browser",
          session_id: "session_1",
          type: "unhandledrejection"
        }
      });

      stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves Next context when browser capture is imported from the Next entrypoint", async () => {
    const listeners: Record<string, EventListenerOrEventListenerObject> = {};
    const addEventListenerMock = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      listeners[type] = listener;
    });
    const calls: Array<{ body: unknown }> = [];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status: 202 });
    });

    vi.stubGlobal("addEventListener", addEventListenerMock);
    vi.stubGlobal("removeEventListener", vi.fn());

    try {
      const client = createSignalMonitorClient({
        endpoint: "https://sigmon.example.com",
        apiKey: "sh_test",
        fetch: fetchImpl
      });
      const stop = installBrowserErrorCapture(client, {
        flush: true,
        context: {
          routeName: "Client /checkout",
          module: "checkout",
          metadata: { component: "browser" }
        }
      });

      (listeners.error as EventListener)({ error: new Error("checkout exploded") } as unknown as Event);

      await vi.waitFor(() => {
        expect(fetchImpl).toHaveBeenCalledTimes(1);
      });

      expect(calls[0].body).toMatchObject({
        message: "checkout exploded",
        source: "Client /checkout",
        context: {
          route_name: "Client /checkout",
          module: "checkout",
          component: "browser",
          mechanism: "browser.error"
        }
      });

      stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
