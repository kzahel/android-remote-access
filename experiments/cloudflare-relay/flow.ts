/** Persisted with each hibernatable socket. No ciphertext is retained here. */
export type Flow = {
  sentBytes: number;
  sentRecords: number;
  ackedBytes: number;
  ackedRecords: number;
  window: number;
  bytes: number;
  messages: number;
  checkpoint?: { nonce: string; bytes: number; records: number };
};
export const freshFlow = (): Flow => ({
  sentBytes: 0,
  sentRecords: 0,
  ackedBytes: 0,
  ackedRecords: 0,
  window: 0,
  bytes: 0,
  messages: 0,
});
export function acknowledge(flow: Flow, nonce: unknown): Flow {
  const { checkpoint, ...rest } = flow;
  if (!checkpoint || nonce !== checkpoint.nonce)
    throw new Error("Invalid receive acknowledgement");
  return {
    ...rest,
    ackedBytes: checkpoint.bytes,
    ackedRecords: checkpoint.records,
  };
}
export function forward(flow: Flow, bytes: number): Flow {
  if (
    bytes > 1048608 ||
    flow.sentBytes - flow.ackedBytes + bytes > 2097152 ||
    flow.sentRecords - flow.ackedRecords >= 128
  )
    throw new Error("Slow peer");
  return {
    ...flow,
    sentBytes: flow.sentBytes + bytes,
    sentRecords: flow.sentRecords + 1,
  };
}
export function receive(flow: Flow, bytes: number, now: number): Flow {
  const reset = now - flow.window >= 1000;
  const next = {
    ...flow,
    window: reset ? now : flow.window,
    bytes: (reset ? 0 : flow.bytes) + bytes,
    messages: (reset ? 0 : flow.messages) + 1,
  };
  if (next.bytes > 4194304 || next.messages > 128)
    throw new Error("Ingress rate");
  return next;
}
