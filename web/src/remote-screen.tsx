import {
  type AppEntry,
  type Command,
  type ControlState,
  resultMessage,
} from "@remote/protocol/control";
import { useEffect, useRef, useState } from "react";
import type { RemoteSession } from "./control-session.js";

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
  const contact = useRef<
    | {
        x: number;
        y: number;
        at: number;
        scene: number;
        pointer: number;
      }
    | undefined
  >(undefined);
  const [state, setState] = useState(initial);
  const [message, setMessage] = useState("");
  const [text, setText] = useState("");
  const [apps, setApps] = useState<AppEntry[]>([]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function capture() {
      try {
        const reply = await session.command({ op: "capture" });
        if (stopped) return;
        if (reply.kind === "image") {
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
          timer = setTimeout(() => {
            void capture();
          }, 650);
      } catch (error) {
        if (!stopped) {
          setMessage(
            error instanceof Error ? error.message : "Connection ended",
          );
          frame.current = undefined;
        }
      }
    }
    void capture();
    return () => {
      stopped = true;
      clearTimeout(timer);
      contact.current = undefined;
    };
  }, [session]);
  async function act(command: Command) {
    try {
      const reply = await session.command(command);
      if (reply.kind === "result" && reply.code)
        setMessage(resultMessage(reply.code));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection ended");
    }
  }
  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const f = frame.current,
      rect = event.currentTarget.getBoundingClientRect();
    if (!f) return undefined;
    return {
      x: Math.min(
        f.width - 1,
        Math.max(
          0,
          Math.floor(((event.clientX - rect.left) * f.width) / rect.width),
        ),
      ),
      y: Math.min(
        f.height - 1,
        Math.max(
          0,
          Math.floor(((event.clientY - rect.top) * f.height) / rect.height),
        ),
      ),
    };
  }
  return (
    <section aria-label="Remote screen">
      <p role="status">{message || "Connected securely"}</p>
      {!state.accessibility && (
        <p>
          On the phone, open Feature setup → Screen access settings to enable
          viewing and touch. Pairing stays saved.
        </p>
      )}
      {state.locked && <p>Phone is locked.</p>}
      <canvas
        ref={canvas}
        aria-label="Phone screen"
        className="phone-screen"
        onPointerDown={(event) => {
          const p = point(event);
          if (!p || !frame.current) return;
          contact.current = {
            ...p,
            scene: frame.current.scene,
            at: Date.now(),
            pointer: event.pointerId,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          contact.current = undefined;
        }}
        onPointerUp={(event) => {
          const start = contact.current;
          contact.current = undefined;
          const end = point(event);
          if (!start || !end || start.pointer !== event.pointerId) return;
          const distance = Math.hypot(end.x - start.x, end.y - start.y);
          void act(
            distance < 12
              ? { op: "tap", scene: start.scene, x: start.x, y: start.y }
              : {
                  op: "swipe",
                  scene: start.scene,
                  x: start.x,
                  y: start.y,
                  endX: end.x,
                  endY: end.y,
                  duration: Math.min(2000, Math.max(40, Date.now() - start.at)),
                },
          );
        }}
      />
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
        <button type="button" onClick={disconnect}>
          Disconnect
        </button>
      </div>
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
