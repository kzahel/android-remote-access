import { useId, useState } from "react";
import { ControlIcon } from "./control-icon.js";

export function RemoteControls({
  navigate,
  wake,
  lock,
  quality,
  type,
  disconnect,
  fullscreen = false,
  toggleFullscreen,
}: {
  navigate?: (action: "back" | "home" | "recents") => void;
  wake?: () => void;
  lock?: () => void;
  quality?: () => void;
  type?: () => void;
  disconnect?: () => void;
  fullscreen?: boolean;
  toggleFullscreen?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const extraId = useId();
  const fullscreenLabel = fullscreen ? "Exit fullscreen" : "Fullscreen";
  return (
    <div className="control-dock">
      <nav className="phone-nav" aria-label="Android navigation">
        {(["back", "home", "recents"] as const).map((action) => {
          const label =
            action === "back" ? "Back" : action === "home" ? "Home" : "Recents";
          return (
            <button
              key={action}
              type="button"
              aria-label={label}
              title={label}
              disabled={!navigate}
              onClick={() => navigate?.(action)}
            >
              <ControlIcon name={action} />
              <span className="control-label" aria-hidden="true">
                {label}
              </span>
            </button>
          );
        })}
      </nav>
      <div
        className="auxiliary-controls"
        id={extraId}
        hidden={fullscreen && !expanded}
      >
        <div className="screen-controls">
          <button
            type="button"
            title="Wake screen"
            disabled={!wake}
            onClick={wake}
          >
            <ControlIcon name="wake" />
            <span className="control-label">Wake screen</span>
          </button>
          <button
            type="button"
            title="Lock phone"
            disabled={!lock}
            onClick={lock}
          >
            <ControlIcon name="lock" />
            <span className="control-label">Lock phone</span>
          </button>
        </div>
        <div className="screen-controls">
          <button
            type="button"
            title="Viewing quality"
            disabled={!quality}
            onClick={quality}
          >
            <ControlIcon name="quality" />
            <span className="control-label">Viewing quality</span>
          </button>
          <button
            type="button"
            title="Type or open an app"
            disabled={!type}
            onClick={type}
          >
            <ControlIcon name="keyboard" />
            <span className="control-label">Type or open an app</span>
          </button>
        </div>
        <div className="screen-controls">
          <button
            type="button"
            title="Disconnect"
            disabled={!disconnect}
            onClick={disconnect}
          >
            <ControlIcon name="disconnect" />
            <span className="control-label">Disconnect</span>
          </button>
        </div>
      </div>
      {fullscreen && (
        <button
          type="button"
          title="More controls"
          aria-label="More controls"
          aria-controls={extraId}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <ControlIcon name="menu" />
          <span className="control-label" aria-hidden="true">
            More
          </span>
        </button>
      )}
      {toggleFullscreen && (
        <button
          type="button"
          title={fullscreenLabel}
          aria-label={fullscreenLabel}
          onClick={() => {
            setExpanded(false);
            toggleFullscreen();
          }}
        >
          <ControlIcon name={fullscreen ? "exit-fullscreen" : "fullscreen"} />
          <span className="control-label" aria-hidden="true">
            {fullscreenLabel}
          </span>
        </button>
      )}
    </div>
  );
}
