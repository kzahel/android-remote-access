import { ForgetPhone, PhoneName } from "./phone-management.js";
import { phoneName, phoneURL, type SavedPhone } from "./store.js";
import { ViewerHeading } from "./viewer-heading.js";

const when = (at: number | undefined) =>
  at ? new Date(at).toLocaleString() : "Not yet";

/** What this browser knows about a phone: its latest self-report and this browser's own history. */
export function PhoneDetails({ phone }: { phone: SavedPhone }) {
  const { device } = phone;
  return (
    <main className="phone-details-page">
      <ViewerHeading
        name={phoneName(phone)}
        status="Details saved in this browser"
      />
      <section aria-label="Name" className="details-name">
        <PhoneName phone={phone}>
          <span className="phone-title">{phoneName(phone)}</span>
        </PhoneName>
        <div className="phone-actions">
          <a className="button-link" href={phoneURL(phone.id)}>
            Open phone
          </a>
          <ForgetPhone phone={phone} />
        </div>
      </section>
      <section aria-labelledby="device-heading">
        <h2 id="device-heading">Phone</h2>
        <dl className="details-list">
          <dt>Device name</dt>
          <dd>{device.name}</dd>
          <dt>Model</dt>
          <dd>
            {device.manufacturer} {device.model}
          </dd>
          <dt>Android</dt>
          <dd>
            {device.android} (API {device.sdk})
          </dd>
          <dt>YepControl app</dt>
          <dd>{device.app}</dd>
          <dt>Reported</dt>
          <dd>{when(phone.deviceAt)}</dd>
        </dl>
      </section>
      <section aria-labelledby="access-heading">
        <h2 id="access-heading">This browser</h2>
        <dl className="details-list">
          <dt>Paired</dt>
          <dd>{when(phone.pairedAt)}</dd>
          <dt>Last contacted</dt>
          <dd>{when(phone.lastContactAt)}</dd>
          <dt>Access</dt>
          <dd>
            {phone.access === "removed"
              ? "Removed on the phone"
              : phone.access === "paused"
                ? "Paused on the phone"
                : "Allowed"}
          </dd>
        </dl>
      </section>
      <section aria-labelledby="history-heading">
        <h2 id="history-heading">History</h2>
        {phone.history.length ? (
          <ol className="details-history">
            {phone.history.map((event) => (
              <li key={`${event.at}-${event.text}`}>
                <time dateTime={new Date(event.at).toISOString()}>
                  {new Date(event.at).toLocaleString()}
                </time>
                <span>{event.text}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="hint">Nothing recorded yet.</p>
        )}
        <p className="hint">
          Kept in this browser only, up to the latest 200 events.
        </p>
      </section>
    </main>
  );
}
