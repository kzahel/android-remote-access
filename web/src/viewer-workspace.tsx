import type { CSSProperties, ReactNode } from "react";
import { useClientSettings } from "./client-settings.js";

export const defaultScreenAspect = 1080 / 2400;

/** A shared frame keeps preview, connecting and live controls in the same place. */
export function ViewerWorkspace({
  children,
  controls,
  aspect = defaultScreenAspect,
}: {
  children: ReactNode;
  controls: ReactNode;
  aspect?: number;
}) {
  const { controlLabels } = useClientSettings();
  return (
    <div
      className="viewer-workspace"
      data-labels={controlLabels || undefined}
      style={{ "--screen-aspect": aspect } as CSSProperties}
    >
      <div className="screen-stage">{children}</div>
      {controls}
    </div>
  );
}
