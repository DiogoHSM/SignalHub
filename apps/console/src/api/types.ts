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

export type ConsoleConfig = {
  apiBasePath: string;
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
  from?: Date | string;
  to?: Date | string;
  limit?: number;
  cursor?: string;
};
