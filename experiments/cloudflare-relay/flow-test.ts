import assert from "node:assert/strict";
import { acknowledge, forward, freshFlow, receive } from "./flow.js";

const full = forward(forward(freshFlow(), 1048576), 1048576);
assert.throws(() => forward(full, 1), /Slow peer/);
assert.throws(() => forward(freshFlow(), 1048609), /Slow peer/);
const checkpoint = { nonce: "ab".repeat(16), bytes: 1048576, records: 1 };
for (const nonce of [undefined, null, 1, "wrong", "cd".repeat(16)])
  assert.throws(() => acknowledge({ ...full, checkpoint }, nonce));
const acked = acknowledge({ ...full, checkpoint }, checkpoint.nonce);
assert.equal(forward(acked, 1048576).sentBytes, 3145728);
assert.throws(() => acknowledge(acked, checkpoint.nonce), /acknowledgement/);
let small = freshFlow();
for (let record = 0; record < 128; record++) small = forward(small, 1);
assert.throws(() => forward(small, 1), /Slow peer/);
let rate = freshFlow();
for (let message = 0; message < 128; message++) rate = receive(rate, 1, 1000);
assert.throws(() => receive(rate, 1, 1000), /Ingress rate/);
assert.equal(receive(rate, 1, 2000).messages, 1);
assert.throws(() => receive(freshFlow(), 4194305, 1000), /Ingress rate/);
console.log(
  "Cloudflare flow bounds passed: byte/record credit, invalid ACKs and ingress budgets.",
);
