import {
  type Command,
  type ControlState,
  resultMessage,
} from "@remote/protocol/control";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RemoteSession } from "./control-session.js";

type UnlockCommand = Extract<Command, { op: "unlock" }> | { op: "unlockSaved" };
const unconfirmedMessage =
  "Couldn’t confirm whether the phone unlocked. The PIN was not retried.";

// This is only an attempt marker, never a credential. The phone's persistent
// guard remains authoritative across browsers and after input starts.
function attemptKey(phoneId: string) {
  return `yepcontrol-unlock-attempt:${phoneId}`;
}

export function usePhoneUnlock(
  phoneId: string,
  session: RemoteSession,
  initial: ControlState,
  state: ControlState,
  onState: (state: ControlState) => void,
) {
  const started = useRef(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const endMessage = useRef("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const status = useRef(state);
  status.current = state;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const unlock = useCallback(
    async (command: UnlockCommand, automatic = false) => {
      const current = status.current;
      if (
        inFlight.current ||
        !current.locked ||
        !current.accessibility ||
        !current.unlockAllowed ||
        current.unlockBlocked
      )
        return;
      try {
        const key = attemptKey(phoneId);
        if (automatic && localStorage.getItem(key) !== null) {
          setMessage(
            "An earlier unlock couldn’t be confirmed. It was not retried automatically.",
          );
          return;
        }
        // Persist before sending, including before keypad preparation. A reload
        // must not repeat an attempt whose delivery or outcome is unknown.
        localStorage.setItem(key, "1");
      } catch {
        if (automatic) {
          setMessage(
            "Automatic unlock is unavailable because this browser couldn’t save the attempt. Choose an unlock method below.",
          );
          return;
        }
        // Explicit input still has the native one-attempt guard.
      }
      inFlight.current = true;
      endMessage.current = unconfirmedMessage;
      setBusy(true);
      const saved = command.op === "unlockSaved";
      setMessage(saved ? "Unlocking with saved PIN…" : "Unlocking phone…");
      try {
        const reply = await session.command(command);
        const refreshed = await session.command({ op: "status" });
        if (!mounted.current) return;
        if (refreshed.kind === "state") {
          endMessage.current = "";
          onState(refreshed.state);
        }
        if (refreshed.kind === "state" && !refreshed.state.locked) {
          setMessage("");
        } else if (
          reply.kind === "result" &&
          reply.code === 4 &&
          refreshed.kind === "state" &&
          !refreshed.state.unlockBlocked
        ) {
          setMessage(
            saved
              ? "Couldn’t enter the saved PIN. You can enter the phone PIN below."
              : "Couldn’t enter the PIN. Check that the phone’s PIN keypad is available.",
          );
        } else {
          setMessage(
            (saved
              ? "We couldn’t unlock the phone using the saved PIN."
              : "We couldn’t unlock the phone using that PIN.") +
              (reply.kind === "result" && reply.code !== 0 && reply.code !== 9
                ? ` ${resultMessage(reply.code)}`
                : ""),
          );
        }
      } catch {
        if (mounted.current) setMessage(unconfirmedMessage);
      } finally {
        inFlight.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [phoneId, session, onState],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Only connection starts automatic unlock. A later Lock action stays locked.
    if (initial.savedPin) void unlock({ op: "unlockSaved" }, true);
  }, [initial, unlock]);

  useEffect(() => {
    if (state.locked || busy || inFlight.current) return;
    setMessage("");
    endMessage.current = "";
    try {
      localStorage.removeItem(attemptKey(phoneId));
    } catch {
      // Without durable browser storage automatic unlock fails closed above.
    }
  }, [phoneId, state.locked, busy]);

  return {
    unlock,
    busy,
    message,
    // Read synchronously: a connection can close before React renders busy/message.
    connectionEndedMessage: () => endMessage.current,
  };
}
