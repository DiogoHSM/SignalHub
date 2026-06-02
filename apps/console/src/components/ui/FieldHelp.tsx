type Props = {
  children: React.ReactNode;
  id?: string;
};

export function FieldHelp({ children, id }: Props) {
  return (
    <p className="field-help" id={id}>
      {children}
    </p>
  );
}
