import { useState } from "react";
import { createRoot } from "react-dom/client";
import { browserSelfCheck } from "./proof.js";

function App() {
  const [status, setStatus] = useState("Ready");
  return (
    <main>
      <h1>Crypto interoperability proof</h1>
      <p>
        Development harness for synthetic messages. No phone control or
        credentials.
      </p>
      <button
        type="button"
        onClick={async () => {
          setStatus("Checking");
          try {
            setStatus(
              (await browserSelfCheck()) ? "Browser crypto passed" : "Failed",
            );
          } catch {
            setStatus("Failed");
          }
        }}
      >
        Check browser crypto
      </button>
      <p role="status">{status}</p>
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing app root");
createRoot(root).render(<App />);
