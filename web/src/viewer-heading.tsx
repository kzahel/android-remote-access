export function ViewerHeading({
  name,
  status,
}: {
  name: string;
  status: string;
}) {
  return (
    <header className="viewer-heading">
      <h1 title={name}>{name}</h1>
      <p className="viewer-status" role="status" title={status}>
        {status}
      </p>
    </header>
  );
}
