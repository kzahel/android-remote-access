import { createContext, useContext } from "react";
import { createPortal } from "react-dom";
export const HeadingTarget = createContext<HTMLElement | null | undefined>(
  undefined,
);
/** Live view owns its status; the shell provides a stable top-bar destination. */
export function ViewerHeading({
  name,
  status,
}: {
  name: string;
  status: string;
}) {
  const target = useContext(HeadingTarget);
  const heading = (
    <div className="viewer-heading">
      <h1 title={name}>{name}</h1>
      <p className="viewer-status" role="status" title={status}>
        {status}
      </p>
    </div>
  );
  return target === undefined
    ? heading
    : target
      ? createPortal(heading, target)
      : null;
}
