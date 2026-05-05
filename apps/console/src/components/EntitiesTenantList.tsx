import { useMemo } from "react";
import type { TenantSummary } from "../api/types";

export type TenantSort = "impact" | "usage" | "errors" | "llmCost" | "recent";

type Props = {
  tenants: TenantSummary[];
  selectedTenantId?: string;
  sort: TenantSort;
  onSortChange: (sort: TenantSort) => void;
  onSelectTenant: (tenant: TenantSummary) => void;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
};

const sortOptions: Array<{ value: TenantSort; label: string }> = [
  { value: "impact", label: "Impact" },
  { value: "usage", label: "Usage" },
  { value: "errors", label: "Errors" },
  { value: "llmCost", label: "LLM cost" },
  { value: "recent", label: "Recent" }
];

function tenantKey(tenant: TenantSummary): string {
  return tenant.isUnassigned ? "_unassigned" : tenant.tenantId ?? "_unassigned";
}

function sortValue(tenant: TenantSummary, sort: TenantSort): number {
  if (sort === "impact") return tenant.impactScore;
  if (sort === "usage") return tenant.events;
  if (sort === "errors") return tenant.errors;
  if (sort === "llmCost") return Number(tenant.llmCostUsd);
  if (!tenant.lastSeenAt) return 0;
  return new Date(tenant.lastSeenAt).getTime();
}

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "none";
}

export function EntitiesTenantList({ tenants, selectedTenantId, sort, onSortChange, onSelectTenant, loading, error, onRetry }: Props) {
  const sortedTenants = useMemo(
    () =>
      [...tenants].sort((left, right) => {
        const byMetric = sortValue(right, sort) - sortValue(left, sort);
        if (byMetric !== 0) return byMetric;
        return left.label.localeCompare(right.label);
      }),
    [tenants, sort]
  );

  return (
    <div className="panel entity-tenant-list">
      <div className="panel-header">
        <h2>Entities</h2>
      </div>
      <div className="entity-sort-controls" aria-label="Sort tenants">
        {sortOptions.map((option) => (
          <button
            aria-pressed={sort === option.value}
            key={option.value}
            onClick={() => onSortChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      {loading ? <p className="muted-text">Loading tenant activity</p> : null}
      {error ? (
        <div className="status-box unavailable">
          <strong>Tenant activity is unavailable.</strong>
          <button onClick={onRetry} type="button">
            Retry
          </button>
        </div>
      ) : null}
      {!loading && !error && sortedTenants.length === 0 ? <p className="muted-text">No tenant activity in this window.</p> : null}
      {!loading && !error && sortedTenants.length > 0 ? (
        <div className="entity-tenant-rows" aria-label="Tenant activity">
          {sortedTenants.map((tenant) => {
            const key = tenantKey(tenant);
            const disabled = tenant.isUnassigned || !tenant.tenantId;
            return (
              <button
                aria-disabled={disabled ? "true" : undefined}
                aria-pressed={selectedTenantId === key}
                className="entity-tenant-row"
                disabled={disabled}
                key={key}
                onClick={() => {
                  if (!disabled) onSelectTenant(tenant);
                }}
                type="button"
              >
                <span>
                  <strong>{tenant.label}</strong>
                  <code>{key}</code>
                </span>
                <span>Impact {tenant.impactScore}</span>
                <span>Events {tenant.events}</span>
                <span>Errors {tenant.errors}</span>
                <span>LLM ${tenant.llmCostUsd}</span>
                <span>Last {formatTimestamp(tenant.lastSeenAt)}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
