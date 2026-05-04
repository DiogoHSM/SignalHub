export type User = {
  id: string;
  email: string;
  isAdmin: boolean;
};

export type Project = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type Environment = {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type ApiKey = {
  id: string;
  projectId: string;
  environmentId: string;
  name: string;
  prefix: string;
  createdAt: string;
  revokedAt: string | null;
};

export type CreatedApiKey = ApiKey & {
  secret: string;
};

export type EventRecord = {
  id: string;
  projectId: string;
  environmentId: string;
  tenantId: string | null;
  userId: string | null;
  sessionId: string | null;
  traceId: string | null;
  timestamp: string;
  receivedAt: string;
  source: string | null;
  release: string | null;
  metadata: unknown;
  name: string;
  properties: unknown;
};

export type ConsoleConfig = {
  apiBasePath: string;
  apiEndpoint: string;
  googleOAuthEnabled: boolean;
};

export type QueryListResponse<T> = {
  data: T[];
  cursor?: string;
};

export type AggregateResponse<T> = {
  data: T;
};

export type QueryFilters = {
  projectId: string;
  environmentId: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  eventName?: string;
  from?: Date | string;
  to?: Date | string;
  limit?: number;
  cursor?: string;
};
