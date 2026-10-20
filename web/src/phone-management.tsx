import { useRef, useState } from "react";
import {
  forgetPhone,
  phoneName,
  renamePhone,
  type SavedPhone,
} from "./store.js";

export function PhoneManagement({ phone }: { phone: SavedPhone }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [alias, setAlias] = useState("");
  const [confirmForget, setConfirmForget] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const name = phoneName(phone);
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
        aria-label={`Manage ${name}`}
        title={`Manage ${name}`}
        onClick={() => {
          setAlias(phone.alias ?? "");
          setConfirmForget(false);
          setError("");
          dialog.current?.showModal();
        }}
      >
        ⋯
      </button>
      <dialog ref={dialog} aria-labelledby={`manage-${phone.id}`}>
        <div className="dialog-heading">
          <h2 id={`manage-${phone.id}`}>
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
              connections in other tabs. To revoke this browser’s access, also
              remove it in the phone app.
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
              <label htmlFor={`alias-${phone.id}`}>Phone name</label>
              <input
                id={`alias-${phone.id}`}
                value={alias}
                placeholder={phone.model || "Your phone"}
                maxLength={60}
                onChange={(event) => setAlias(event.target.value)}
              />
              <p className="hint">
                Saved in this browser. Leave blank to use the phone’s model.
              </p>
              {phone.model && <p>Model: {phone.model}</p>}
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
      </dialog>
    </>
  );
}
