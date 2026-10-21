import { createRoot } from "react-dom/client";
import "./viewer.css";

// The fragment contains a short-lived pairing secret. Never forward it to Play,
// analytics, storage or another origin. Installing requires a fresh scan.
history.replaceState(null, "", location.pathname);
const root = document.getElementById("root");
if (!root) throw new Error("Missing root");
createRoot(root).render(
  <main>
    <h1>Get YepControl on your phone</h1>
    <p>Install YepControl on the Android phone you want to reach remotely.</p>
    <p>YepControl is not available on Google Play yet.</p>
    <a
      className="button-link"
      href="https://play.google.com/store/apps/details?id=com.yepcontrol.app"
      rel="noreferrer"
    >
      Check Google Play
    </a>
    <p>
      After installing, open YepControl and tap Scan pairing code. Scan a fresh
      code from your other device and tap Grant.
    </p>
    <p>
      Already installed? Open YepControl and scan the code from inside the app.
    </p>
    <a href="/">Open YepControl in this browser</a>
    <p>
      <a href="/privacy/">Privacy policy</a>
    </p>
  </main>,
);
