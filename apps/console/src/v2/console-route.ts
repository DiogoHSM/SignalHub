import type { NavSection } from "./nav";

export type ConsoleDetail =
  | { target: "incident"; groupId: string; errorId?: string }
  | { target: "tenant"; tenantId: string };

export type ConsoleRoute = {
  nav: NavSection;
  detail: ConsoleDetail | null;
  projectId?: string;
  environmentId?: string;
  valid: boolean;
  root: boolean;
};

export type ConsoleScope = {
  projectId?: string;
  environmentId?: string;
};

const SECTIONS: readonly NavSection[] = [
  "overview",
  "investigate",
  "incidents",
  "llm",
  "traces",
  "entities",
  "users",
  "events",
  "analytics",
  "alerts",
  "monitors",
  "experiments",
  "system",
  "settings",
];

const SECTION_SET = new Set<string>(SECTIONS);

export function parseConsoleRoute(location: Pick<Location, "pathname" | "search">): ConsoleRoute {
  const pathname = normalizePath(location.pathname);
  const params = new URLSearchParams(location.search);
  const scope = {
    projectId: optionalParam(params, "project_id"),
    environmentId: optionalParam(params, "environment_id"),
  };

  if (pathname === "/" || pathname === "/console") {
    return { nav: "overview", detail: null, ...scope, valid: false, root: true };
  }

  const incidentMatch = pathname.match(/^\/console\/incidents\/error-groups\/([^/]+)$/);
  if (incidentMatch) {
    const groupId = decodeSegment(incidentMatch[1]);
    if (groupId) {
      return {
        nav: "incidents",
        detail: { target: "incident", groupId, errorId: optionalParam(params, "error_id") },
        ...scope,
        valid: true,
        root: false,
      };
    }
  }

  const tenantMatch = pathname.match(/^\/console\/entities\/tenants\/([^/]+)$/);
  if (tenantMatch) {
    const tenantId = decodeSegment(tenantMatch[1]);
    if (tenantId) {
      return {
        nav: "entities",
        detail: { target: "tenant", tenantId },
        ...scope,
        valid: true,
        root: false,
      };
    }
  }

  const sectionMatch = pathname.match(/^\/console\/([^/]+)$/);
  const section = sectionMatch?.[1];
  if (section && SECTION_SET.has(section)) {
    return { nav: section as NavSection, detail: null, ...scope, valid: true, root: false };
  }

  return { nav: "overview", detail: null, ...scope, valid: false, root: false };
}

export function buildConsoleUrl(nav: NavSection, detail: ConsoleDetail | null, scope: ConsoleScope = {}): string {
  let pathname = `/console/${nav}`;
  if (detail?.target === "incident") {
    pathname = `/console/incidents/error-groups/${encodeURIComponent(detail.groupId)}`;
  } else if (detail?.target === "tenant") {
    pathname = `/console/entities/tenants/${encodeURIComponent(detail.tenantId)}`;
  }

  const params = new URLSearchParams();
  if (scope.projectId) params.set("project_id", scope.projectId);
  if (scope.environmentId) params.set("environment_id", scope.environmentId);
  if (detail?.target === "incident" && detail.errorId) params.set("error_id", detail.errorId);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function detailOwner(detail: ConsoleDetail): NavSection {
  return detail.target === "incident" ? "incidents" : "entities";
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

function optionalParam(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key)?.trim();
  return value || undefined;
}

function decodeSegment(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}
