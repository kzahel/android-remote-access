/** Reliable ordered DataChannels use bounded chunks rather than depending on SCTP message limits. */
export const RECORD_LIMIT = 1048640;
export function fragmentRecord(
  record: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer>[] {
  if (!record.length || record.length > RECORD_LIMIT)
    throw new Error("Invalid record length");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (let offset = 0; offset < record.length; offset += 16384) {
    const payload = record.subarray(
      offset,
      Math.min(offset + 16384, record.length),
    );
    const chunk = new Uint8Array(12 + payload.length),
      v = new DataView(chunk.buffer);
    v.setUint32(0, 0x41524431);
    v.setUint32(4, record.length);
    v.setUint32(8, offset);
    chunk.set(payload, 12);
    chunks.push(chunk);
  }
  return chunks;
}
export class RecordAssembler {
  private buffer: Uint8Array<ArrayBuffer> | undefined;
  private offset = 0;
  private deadline = 0;
  expired(now: number) {
    return this.buffer !== undefined && now >= this.deadline;
  }
  accept(
    chunk: Uint8Array<ArrayBuffer>,
    now: number,
  ): Uint8Array<ArrayBuffer> | undefined {
    if (chunk.length < 13 || chunk.length > 16396 || this.expired(now))
      throw new Error("Invalid record fragment");
    const v = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength),
      total = v.getUint32(4),
      offset = v.getUint32(8);
    if (
      v.getUint32(0) !== 0x41524431 ||
      !total ||
      total > RECORD_LIMIT ||
      offset !== this.offset ||
      (this.buffer && this.buffer.length !== total) ||
      offset + chunk.length - 12 > total
    )
      throw new Error("Invalid record fragment");
    if (!this.buffer) {
      this.buffer = new Uint8Array(total);
      this.deadline = now + 5000;
    }
    this.buffer.set(chunk.subarray(12), offset);
    this.offset += chunk.length - 12;
    if (this.offset === total) {
      const record = this.buffer;
      this.buffer = undefined;
      this.offset = 0;
      return record;
    }
    return undefined;
  }
}
