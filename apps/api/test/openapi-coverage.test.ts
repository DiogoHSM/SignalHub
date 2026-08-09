import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

// ---------------------------------------------------------------------------
// printRoutes() parser
//
// `app.printRoutes({ commonPrefix: false })` renders Fastify's internal
// find-my-way router as a RADIX TREE, not a flat route list — this is an
// internal implementation detail of Fastify's printRoutes output format, not
// a public contract. A major Fastify upgrade could change the box-drawing
// characters, spacing, or param syntax and silently break this guard. See
// PER-458.
//
// Two traps here cost real time during the 2026-08-02 OpenAPI coverage
// audit and will bite anyone who touches this parser again:
//
// 1. A leaf's real path is the CONCATENATION of every ancestor fragment on
//    the lines above it, not just its own line. Depth is encoded purely by
//    the box-drawing gutter: 4 characters per level ("├── " / "└── " marks
//    the node's own line; "│   " / "    " continues an ancestor's column
//    one level further down). Parsing line-by-line without accumulating
//    ancestors produces garbage like "GET /{id}" or "DELETE /{participantId}"
//    — that was the first (wrong) result of the audit: 91 false positives.
// 2. The tree COLLAPSES SIBLING PARAM NAMES that share a tree position into
//    a single node printed as ":id|:projectId" (colon-prefixed, not the
//    "{name}" the OpenAPI document uses). Comparing literal strings between
//    the two sides false-positives in both directions, so both sides must
//    be reduced to a path SHAPE before comparing. The shape regex is
//    `\{[^}]*\}(?:\|\{[^}]*\})*` → single wildcard. The repeated optional
//    group is load-bearing: `\{[^}]*\}` alone turns "{id}|{projectId}" into
//    "*|*", which will not match the "*" produced for a plain "{id}".
// ---------------------------------------------------------------------------

type RegisteredRoute = { method: string; path: string };

const SKIPPED_METHODS = new Set(["HEAD", "OPTIONS"]);

function parsePrintedRoutes(printed: string): RegisteredRoute[] {
  const routes: RegisteredRoute[] = [];
  const ancestry: string[] = [];

  for (const line of printed.split("\n")) {
    if (!line.trim()) continue;

    const markerIndex = Math.max(line.indexOf("├── "), line.indexOf("└── "));
    if (markerIndex === -1) continue; // not a route line (defensive)

    const depth = (markerIndex + 4) / 4 - 1;
    const rest = line.slice(markerIndex + 4);

    const methodsStart = rest.lastIndexOf(" (");
    if (methodsStart === -1 || !rest.endsWith(")")) continue; // defensive

    const fragment = rest.slice(0, methodsStart);
    const methods = rest
      .slice(methodsStart + 2, -1)
      .split(",")
      .map((method) => method.trim())
      .filter(Boolean);

    ancestry[depth] = fragment;
    ancestry.length = depth + 1;

    const fullPath = ancestry.join("");
    if (!fullPath.startsWith("/")) continue; // skips the bare "*" OPTIONS catch-all

    for (const method of methods) {
      if (SKIPPED_METHODS.has(method)) continue;
      routes.push({ method, path: fullPath });
    }
  }

  return routes;
}

// Reduces a path to its parameter SHAPE for comparison. Handles both
// printRoutes' colon syntax (":id", collapsed siblings as ":id|:projectId")
// and openapi.json's brace syntax ("{id}") through the same function: the
// colon->brace step is a no-op on paths that have no colons.
function pathShape(path: string): string {
  const bracketed = path.replace(/:[^/|]+(?:\|:[^/|]+)*/g, (group) =>
    group
      .split("|")
      .map((token) => `{${token.slice(1)}}`)
      .join("|")
  );
  return bracketed.replace(/\{[^}]*\}(?:\|\{[^}]*\})*/g, "*");
}

// Human-readable form for error messages and allowlist entries. Sibling
// param names collapsed onto the same tree node (":id|:projectId") don't
// correspond to one real name, so they render as the generic "{param}".
function displayPath(path: string): string {
  return path.replace(/:[^/|]+(?:\|:[^/|]+)*/g, (group) => (group.includes("|") ? "{param}" : `{${group.slice(1)}}`));
}

function routeKey(method: string, path: string): string {
  return `${method} ${pathShape(path)}`;
}

// -----------------------------------------------------------------------
// Allowlists
// -----------------------------------------------------------------------

// Docs/console plumbing that legitimately is not product surface: the
// Scalar docs UI (and its redirect/asset routes), the raw OpenAPI
// documents, the SDK guide (and its redirect), and the console's runtime
// config endpoint. None of these are meant to appear in openapi.json's
// `paths`, so they are exempted here instead of being "fixed" by adding
// docs-about-docs entries to the spec.
const DOCS_INFRA_ROUTES = new Set<string>([
  "GET /docs",
  "GET /docs/",
  "GET /docs/js/scalar.js",
  "GET /docs/openapi.json",
  "GET /docs/openapi.yaml",
  "GET /openapi.json",
  "GET /sdk",
  "GET /sdk/",
  "GET /console/config"
]);

// The /admin/* routes still undocumented in openapi.ts, tracked by PER-460.
// This is a SHRINKING baseline, NOT a permanent exemption — as PER-460
// documents each route, DELETE its entry from this list. Do not add newly
// discovered undocumented /admin/* routes here without also filing/updating
// PER-460; do not grow this list to make an unrelated change pass.
//
// Generated by running this test's parser against the live app and listing
// every registered /admin/* route with no matching openapi.json entry — not
// hand-copied.
const PENDING_ADMIN_ROUTES = new Set<string>([
  "GET /admin/users",
  "POST /admin/users",
  "PATCH /admin/users/{id}",
  "DELETE /admin/users/{id}",
  "GET /admin/projects/{param}",
  "PATCH /admin/projects/{param}",
  "DELETE /admin/projects/{param}",
  "GET /admin/projects/{param}/browser-origins",
  "POST /admin/projects/{param}/browser-origins",
  "DELETE /admin/browser-origins/{id}",
  "GET /admin/analytics-segments",
  "POST /admin/analytics-segments",
  "PATCH /admin/analytics-segments/{id}",
  "DELETE /admin/analytics-segments/{id}",
  "GET /admin/analytics-segments/{id}/preview",
  "PATCH /admin/api-keys/{id}",
  "DELETE /admin/api-keys/{id}",
  "GET /admin/alert-rules",
  "POST /admin/alert-rules",
  "PATCH /admin/alert-rules/{id}",
  "DELETE /admin/alert-rules/{id}",
  "GET /admin/experiments",
  "POST /admin/experiments",
  "PATCH /admin/experiments/{id}",
  "DELETE /admin/experiments/{id}",
  "PATCH /admin/environments/{id}",
  "DELETE /admin/environments/{id}",
  "PATCH /admin/source-map-upload-tokens/{id}",
  "DELETE /admin/source-map-upload-tokens/{id}",
  "GET /admin/source-maps",
  "POST /admin/source-maps",
  "DELETE /admin/source-maps/{id}",
  "GET /admin/notification-channels",
  "POST /admin/notification-channels",
  "PATCH /admin/notification-channels/{id}",
  "DELETE /admin/notification-channels/{id}"
]);

describe("OpenAPI route coverage guard", () => {
  it("documents every registered product route (PER-461)", async () => {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      nodeEnv: "production"
    });

    const printed = app.printRoutes({ commonPrefix: false });
    const registered = parsePrintedRoutes(printed);
    expect(registered.length).toBeGreaterThan(0); // parser sanity: never silently return nothing

    const specResponse = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(specResponse.statusCode).toBe(200);
    const spec = specResponse.json() as { paths: Record<string, Record<string, unknown>> };

    const documented = new Set<string>();
    for (const [path, operations] of Object.entries(spec.paths)) {
      for (const method of Object.keys(operations)) {
        const upper = method.toUpperCase();
        if (SKIPPED_METHODS.has(upper)) continue;
        documented.add(routeKey(upper, path));
      }
    }

    const undocumented: string[] = [];
    for (const route of registered) {
      const key = routeKey(route.method, route.path);
      if (documented.has(key)) continue;

      const display = `${route.method} ${displayPath(route.path)}`;
      if (DOCS_INFRA_ROUTES.has(display) || PENDING_ADMIN_ROUTES.has(display)) continue;

      undocumented.push(display);
    }

    if (undocumented.length > 0) {
      throw new Error(
        `${undocumented.length} registered route(s) have no openapi.json entry and are not in an allowlist. ` +
          `Document them in apps/api/src/openapi.ts, or if they are genuinely infra, add them to DOCS_INFRA_ROUTES ` +
          `(with justification) — do not silence this by growing PENDING_ADMIN_ROUTES for non-admin routes.\n` +
          undocumented.map((route) => `  - ${route}`).join("\n")
      );
    }

    // PENDING_ADMIN_ROUTES is a shrinking baseline (PER-460), not a
    // permanent exemption. If an entry here is now documented, the
    // baseline has rotted: DELETE the entry from PENDING_ADMIN_ROUTES
    // above — do not re-add it to openapi.ts or otherwise "fix" this by
    // touching the spec.
    const staleEntries = [...PENDING_ADMIN_ROUTES].filter((entry) => {
      const spaceIndex = entry.indexOf(" ");
      const method = entry.slice(0, spaceIndex);
      const path = entry.slice(spaceIndex + 1);
      return documented.has(routeKey(method, path));
    });

    if (staleEntries.length > 0) {
      throw new Error(
        `${staleEntries.length} entr${staleEntries.length === 1 ? "y" : "ies"} in PENDING_ADMIN_ROUTES ` +
          `(apps/api/test/openapi-coverage.test.ts) ${staleEntries.length === 1 ? "is" : "are"} now documented in openapi.json. ` +
          `DELETE ${staleEntries.length === 1 ? "this entry" : "these entries"} from PENDING_ADMIN_ROUTES — the baseline has rotted, do not add ${staleEntries.length === 1 ? "it" : "them"} back.\n` +
          staleEntries.map((route) => `  - ${route}`).join("\n")
      );
    }
  });
});
