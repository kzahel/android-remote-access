import {
  type AppEntry,
  type Command,
  type ControlState,
  resultMessage,
} from "@remote/protocol/control";
import { useEffect, useRef, useState } from "react";
import type { RemoteSession } from "./control-session.js";
import { TouchInput } from "./touch-input.js";
import { VideoRenderer } from "./video-renderer.js";

/** Media and pointer coordinates stay in refs; React owns only status and controls. */
export function RemoteScreen({
  session,
  initial,
  disconnect,
}: {
  session: RemoteSession;
  initial: ControlState;
  disconnect: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<
    { scene: number; width: number; height: number } | undefined
  >(undefined);
  const touch = useRef<TouchInput | undefined>(undefined);
  const [state, setState] = useState(initial);
  const [message, setMessage] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [text, setText] = useState("");
  const [pin, setPin] = useState("");
  const [quality, setQuality] = useState(0);
  const [connectionPath, setConnectionPath] = useState(session.path);
  const [apps, setApps] = useState<AppEntry[]>([]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const input = canvas.current
      ? new TouchInput(canvas.current, session, () => frame.current, setMessage)
      : undefined;
    touch.current = input;
    let videoActive = false;
    let lastStatus = 0;
    let shownVideo = false;
    const renderer = canvas.current
      ? new VideoRenderer(canvas.current, (meta) => {
          frame.current = meta;
          shownVideo = true;
          setMessage("Smooth view");
        })
      : undefined;
    async function capture() {
      if (input?.active && !videoActive) {
        timer = setTimeout(() => {
          void capture();
        }, 150);
        return;
      }
      try {
        if (Date.now() - lastStatus > 1500) {
          const status = await session.command({ op: "status" });
          if (stopped) return;
          if (status.kind === "state") {
            videoActive = status.state.videoActive === true;
            setState(status.state);
            setConnectionPath(session.path);
            if (!videoActive && shownVideo) {
              renderer?.close();
              shownVideo = false;
              setMessage("Smooth view ended. Still frames are available.");
            }
          }
          lastStatus = Date.now();
        }
        const reply = await session.command({
          op: videoActive ? "videoFrame" : "capture",
        });
        if (stopped) return;
        if (reply.kind === "video") {
          if (!renderer?.push(reply)) await session.command({ op: "videoKey" });
        } else if (videoActive && reply.kind === "result" && reply.code === 6) {
          // No frame is ready. The bounded encoder mailbox never queues an idle capture.
        } else if (reply.kind === "image") {
          const image = await createImageBitmap(
            new Blob([reply.jpeg], { type: "image/jpeg" }),
          );
          if (!stopped && canvas.current) {
            const target = canvas.current;
            target.width = reply.width;
            target.height = reply.height;
            target
              .getContext("2d")
              ?.drawImage(image, 0, 0, reply.width, reply.height);
            frame.current = reply;
            setMessage("");
          }
          image.close();
        } else if (reply.kind === "result") {
          frame.current = undefined;
          canvas.current
            ?.getContext("2d")
            ?.clearRect(0, 0, canvas.current.width, canvas.current.height);
          setMessage(resultMessage(reply.code));
          const status = await session.command({ op: "status" });
          if (!stopped && status.kind === "state") setState(status.state);
        }
        if (!stopped)
          timer = setTimeout(
            () => {
              void capture();
            },
            videoActive ? 16 : 650,
          );
      } catch (error) {
        if (!stopped) {
          setActionMessage("");
          setMessage(
            error instanceof Error ? error.message : "Connection ended",
          );
          frame.current = undefined;
          if (session.connected)
            timer = setTimeout(() => {
              void capture();
            }, 500);
        }
      }
    }
    void capture();
    return () => {
      stopped = true;
      clearTimeout(timer);
      renderer?.close();
      input?.close();
      touch.current = undefined;
    };
  }, [session]);
  async function act(command: Command) {
    setActionMessage("");
    try {
      const reply = await session.command(command);
      if (["unlock", "unlockSaved", "wake", "sleep"].includes(command.op)) {
        const status = await session.command({ op: "status" });
        if (status.kind === "state") setState(status.state);
      }
      if (reply.kind === "result" && reply.code)
        setActionMessage(resultMessage(reply.code));
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "Connection ended",
      );
    }
  }
  return (
    <section aria-label="Remote screen" data-transport={connectionPath}>
      <p role="status">{actionMessage || message || "Connected securely"}</p>
      {!state.accessibility && (
        <p>
          On the phone, open Feature setup → Screen access settings to enable
          viewing and touch. Pairing stays saved.
        </p>
      )}
      {state.locked && (
        <div>
          <p>Phone is locked.</p>
          {!state.unlockAllowed && (
            <p>
              Allow unlocking for this browser in the phone app’s browser
              settings.
            </p>
          )}
          {state.unlockBlocked && (
            <p>
              Unlock was already attempted. Unlock the phone locally before
              another attempt.
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const value = pin;
              setPin("");
              void act({ op: "unlock", pin: value });
            }}
          >
            <label>
              Phone PIN
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={16}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={!state.unlockAllowed || state.unlockBlocked}
            >
              Unlock phone
            </button>
          </form>
          {state.savedPin && (
            <button
              type="button"
              disabled={!state.unlockAllowed || state.unlockBlocked}
              onClick={() => {
                if (
                  window.confirm(
                    "Unlock this phone using its saved PIN? One attempt will be made.",
                  )
                )
                  void act({ op: "unlockSaved" });
              }}
            >
              Use saved PIN
            </button>
          )}
        </div>
      )}
      <canvas ref={canvas} aria-label="Phone screen" className="phone-screen" />
      <div className="controls">
        {(["back", "home", "recents"] as const).map((action) => (
          <button
            key={action}
            type="button"
            onClick={() => void act({ op: "navigation", action })}
          >
            {action[0]?.toUpperCase()}
            {action.slice(1)}
          </button>
        ))}
        <button type="button" onClick={() => void act({ op: "wake" })}>
          Wake screen
        </button>
        <button type="button" onClick={() => void act({ op: "sleep" })}>
          Lock phone
        </button>
        <button type="button" onClick={disconnect}>
          Disconnect
        </button>
      </div>
      <details>
        <summary>Viewing quality</summary>
        <p>
          Connection: {connectionPath === "direct" ? "Direct" : "Hosted relay"}
        </p>
        <label>
          Smooth view
          <select
            aria-label="Viewing quality"
            value={quality}
            disabled={!VideoRenderer.supported()}
            onChange={(event) => {
              const value = Number(event.target.value) as 0 | 1 | 2 | 3;
              setQuality(value);
              if (value)
                setMessage(
                  "Approve screen sharing on the phone to start smooth view.",
                );
              void act({ op: "video", quality: value });
            }}
          >
            <option value={0}>Still frames</option>
            <option value={1}>Save data</option>
            <option value={2}>Balanced</option>
            <option value={3}>Smooth</option>
          </select>
        </label>
        {quality > 0 && !state.videoActive && (
          <button
            type="button"
            onClick={() =>
              void act({ op: "video", quality: quality as 1 | 2 | 3 })
            }
          >
            Start smooth view
          </button>
        )}
        {!VideoRenderer.supported() && (
          <p>
            This browser supports still frames. Use a browser with video
            decoding for smooth view.
          </p>
        )}
        <p>
          Android asks for screen-sharing approval on the phone. After locking
          or restarting, approve again.
        </p>
      </details>
      <details>
        <summary>Type or open an app</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void act({ op: "text", text });
            setText("");
          }}
        >
          <label>
            Text for the focused field
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoComplete="off"
            />
          </label>
          <button type="submit">Send text</button>
        </form>
        <button
          type="button"
          onClick={async () => {
            try {
              const reply = await session.command({ op: "apps" });
              if (reply.kind === "apps") setApps(reply.apps);
            } catch (error) {
              setMessage(
                error instanceof Error ? error.message : "Couldn’t load apps",
              );
            }
          }}
        >
          Choose an app
        </button>
        {apps.length > 0 && (
          <label>
            Open app
            <select
              aria-label="Open app"
              defaultValue=""
              onChange={(event) => {
                if (event.target.value)
                  void act({ op: "launch", packageName: event.target.value });
              }}
            >
              <option value="" disabled>
                Choose an app…
              </option>
              {apps.map((app) => (
                <option key={app.packageName} value={app.packageName}>
                  {app.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </details>
    </section>
  );
}
