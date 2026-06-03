type Props = {
  title: string;
  description: string;
  action?: React.ReactNode;
};

export function EmptyState({ action, description, title }: Props) {
  return (
    <div className="console-empty-state">
      <strong>{title}</strong>
      <p>{description}</p>
      {action ? <div className="console-empty-state__action">{action}</div> : null}
    </div>
  );
}
