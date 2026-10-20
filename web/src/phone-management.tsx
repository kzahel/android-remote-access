import { useEffect, useId, useRef, useState } from "react";
import { ControlIcon } from "./control-icon.js";
import {
  forgetPhone,
  phoneName,
  renamePhone,
  type SavedPhone,
} from "./store.js";

export function PhoneManagement({
  phone,
  label,
}: {
  phone: SavedPhone;
  label?: string;
}) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const [alias, setAlias] = useState("");
  const [confirmForget, setConfirmForget] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const name = phoneName(phone);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  async function change(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      dialog.current?.close();
    } catch {
      setError(
        "Couldn’t save this change. Check that site storage is available.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="manage-phone"
        type="button"
        aria-label={label || `Manage ${name}`}
        title={label || "Phone details"}
        onClick={() => {
          setAlias(phone.alias ?? "");
          setConfirmForget(false);
          setError("");
          setOpen(true);
        }}
      >
        <ControlIcon name="info" />
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`manage-${uid}`}
        onClose={() => setOpen(false)}
      >
        {open && (
          <>
            <div className="dialog-heading">
              <h2 id={`manage-${uid}`}>
                {confirmForget ? `Forget ${name}?` : "Phone settings"}
              </h2>
              <button
                type="button"
                aria-label="Close phone settings"
                onClick={() => dialog.current?.close()}
              >
                ×
              </button>
            </div>
            {confirmForget ? (
              <>
                <p>
                  This removes the phone from this browser and closes its
                  connections in other tabs. To revoke this browser’s access,
                  also remove it in the phone app.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void change(() => forgetPhone(phone.id))}
                >
                  Forget phone
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setConfirmForget(false)}
                >
                  Keep phone
                </button>
              </>
            ) : (
              <>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void change(() => renamePhone(phone.id, alias));
                  }}
                >
                  <label htmlFor={`alias-${uid}`}>Phone name</label>
                  <input
                    id={`alias-${uid}`}
                    value={alias}
                    placeholder={phone.model || "Your phone"}
                    maxLength={60}
                    onChange={(event) => setAlias(event.target.value)}
                  />
                  <p className="hint">
                    Saved in this browser. Leave blank to use the phone’s model.
                  </p>
                  <dl className="phone-details">
                    <dt>Model</dt>
                    <dd>{phone.model || "Not contacted yet"}</dd>
                    <dt>Last contacted</dt>
                    <dd>
                      {phone.lastContactAt
                        ? new Date(phone.lastContactAt).toLocaleString()
                        : "Not contacted yet"}
                    </dd>
                  </dl>
                  <button type="submit" disabled={busy}>
                    Save name
                  </button>
                </form>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setConfirmForget(true)}
                >
                  Forget this phone
                </button>
              </>
            )}
            {error && <p role="alert">{error}</p>}
          </>
        )}
      </dialog>
    </>
  );
}
