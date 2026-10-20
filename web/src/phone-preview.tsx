import type { PhoneFeatures } from "@remote/protocol/features";
import { ControlIcon } from "./control-icon.js";
import { LastContact } from "./phone-list.js";
import { RemoteControls } from "./remote-controls.js";
import { ViewerWorkspace } from "./viewer-workspace.js";

export function PhonePreview({
  pending,
  connect,
  cancel,
  features,
  lastContactAt,
}: {
  pending: "check" | "control" | undefined;
  connect: () => void;
  cancel: () => void;
  features: PhoneFeatures | undefined;
  lastContactAt: number | undefined;
}) {
  return (
    <section className="remote-viewer phone-preview" aria-label="Phone preview">
      <ViewerWorkspace controls={<RemoteControls />}>
        <div className="screen-overlay preview-overlay">
          <div className="screen-panel connect-panel">
            <ControlIcon name="phone" />
            <button
              type="button"
              aria-label="Connect to phone"
              disabled={pending === "control"}
              onClick={connect}
            >
              {pending === "control" ? "Connecting…" : "Connect"}
            </button>
            <p className="contact-detail">
              <LastContact at={lastContactAt} />
            </p>
            {pending && (
              <button className="secondary" type="button" onClick={cancel}>
                Cancel connection
              </button>
            )}
            {features && (
              <details className="preview-features">
                <summary>Phone features</summary>
                <section aria-label="Phone features">
                  <dl>
                    <dt>Screen viewing</dt>
                    <dd>{feature(features.screenViewing)}</dd>
                    <dt>Touch control</dt>
                    <dd>{feature(features.touchControl)}</dd>
                    <dt>Connection requests</dt>
                    <dd>{requests(features.connectionRequests)}</dd>
                  </dl>
                </section>
              </details>
            )}
          </div>
        </div>
      </ViewerWorkspace>
    </section>
  );
}
function feature(value: PhoneFeatures["screenViewing"]) {
  return value === "enabled"
    ? "Enabled"
    : value === "permission-needed"
      ? "Enable screen access in the phone app"
      : "Unavailable";
}
function requests(value: PhoneFeatures["connectionRequests"]) {
  return value === "enabled"
    ? "Enabled"
    : value === "off"
      ? "Off"
      : value === "notifications-needed"
        ? "Enable notifications on the phone"
        : value === "setup-needed"
          ? "Review connection settings on the phone"
          : "Unavailable";
}
