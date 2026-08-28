import { describe, expect, it, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createFakeTargetServer } from "./fake-target-server.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("createFakeTargetServer", () => {
  it("defaults a key to up (200)", async () => {
    app = createFakeTargetServer({ controlToken: "secret" });
    const response = await app.inject({ method: "GET", url: "/t/checkout" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("rejects a control request without the correct bearer token", async () => {
    app = createFakeTargetServer({ controlToken: "secret" });
    const response = await app.inject({
      method: "POST",
      url: "/control/checkout",
      headers: { authorization: "Bearer wrong" },
      payload: { state: "down" }
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects an invalid state value", async () => {
    app = createFakeTargetServer({ controlToken: "secret" });
    const response = await app.inject({
      method: "POST",
      url: "/control/checkout",
      headers: { authorization: "Bearer secret" },
      payload: { state: "sideways" }
    });
    expect(response.statusCode).toBe(400);
  });

  it("flips a key to down (503) and back to up (200) via the control route", async () => {
    app = createFakeTargetServer({ controlToken: "secret" });

    const down = await app.inject({
      method: "POST",
      url: "/control/checkout",
      headers: { authorization: "Bearer secret" },
      payload: { state: "down" }
    });
    expect(down.statusCode).toBe(200);

    const polledDown = await app.inject({ method: "GET", url: "/t/checkout" });
    expect(polledDown.statusCode).toBe(503);
    expect(polledDown.json()).toEqual({ ok: false });

    await app.inject({
      method: "POST",
      url: "/control/checkout",
      headers: { authorization: "Bearer secret" },
      payload: { state: "up" }
    });

    const polledUp = await app.inject({ method: "GET", url: "/t/checkout" });
    expect(polledUp.statusCode).toBe(200);
  });

  it("keeps state independent per key", async () => {
    app = createFakeTargetServer({ controlToken: "secret" });
    await app.inject({
      method: "POST",
      url: "/control/checkout",
      headers: { authorization: "Bearer secret" },
      payload: { state: "down" }
    });

    const otherKey = await app.inject({ method: "GET", url: "/t/payments" });
    expect(otherKey.statusCode).toBe(200);
  });
});
