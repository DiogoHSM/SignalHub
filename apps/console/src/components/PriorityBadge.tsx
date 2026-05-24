import type { ErrorGroupPriority } from "../api/types";

type Props = {
  priority: ErrorGroupPriority | null;
  suggested?: ErrorGroupPriority;
};

export function PriorityBadge({ priority, suggested }: Props) {
  const value = priority ?? suggested ?? null;
  if (!value) return <span className="badge muted">no priority</span>;
  return (
    <span className={`badge priority-${value}`}>
      {value}
      {priority ? "" : " suggested"}
    </span>
  );
}
