# Hosting and TURN: potential future direction

Recorded **2026-10-21** at the owner's request. These are options discussed for
later, not decisions or deployments. The development relay keeps running on the
home Pi; nothing here changes it. The owner registered **yepcontrol.com** on the
same day; no DNS or service uses it yet.

## Constraint every host must keep

For one pairing, the phone's and the browser's relay WebSockets must reach the
same process, because routing is held in memory (`relay/src/server.ts`). FCM is
an outbound HTTPS call with service-account credentials and works from any host.
Each pairing also stores its relay origin, so phones paired against the current
hostname stay with it unless that hostname keeps pointing at the relay or the
phone pairs again.

## Relay hosting options

| Option | Code change | Notes |
| --- | --- | --- |
| Cloudflare Tunnel to the Pi | None | No inbound port; still bound to home power, uptime and upload. Suits development. |
| Small single-instance VPS or app host (Fly.io, Hetzner, Render, Railway…) | Container plus a persistent volume for `pairings-v1.json` | Simplest real hosting. Must stay one instance, one region. |
| Google Cloud Run | Small | WebSockets work, but default scale-out splits routes; pinned to one instance it is a VPS with a poor fit for long connections. |
| Cloudflare Workers + Durable Objects | Port of `server.ts`/`push.ts` | One object per pairing ID meets both sockets by design. Object storage replaces the JSON file; alarms replace timers; hibernation keeps idle sockets cheap. `ws`, file writes and Node `randomBytes` go; IP limits move to Cloudflare rules. `firebase-admin` likely does not run there, so FCM HTTP v1 would be called directly with a WebCrypto-signed service-account token. Worker WebSocket messages are capped near 1 MiB, close to the relay's current limit. |

Suggested sequence: put the relay on a yepcontrol.com hostname (Tunnel or an
unchanged single-instance host) to take traffic off the home connection, then
port to Workers + Durable Objects before a public launch, using the relay test
suite as the acceptance bar. Recheck prices and limits at decision time.

## TURN for the direct WebRTC lane

Today the browser (`web/src/direct-lane.ts`) and phone
(`transport/DirectLink.kt`) use only Google's public STUN server; when direct
connectivity fails, video falls back to the WebSocket relay. The
[production plan](production-plan.md) currently states that no TURN service is
planned; adopting one would revise that.

In either variant the relay issues short-lived TURN credentials to each side
after it authenticates that side, before the direct lane starts. TURN only
forwards packets: WebRTC encryption and the lane's own end-to-end keys still
apply, and the WebSocket relay remains the fallback.

### Self-hosted coturn on the Pi, Cloudflare as fallback

- coturn in `use-auth-secret` mode: the relay derives time-limited credentials
  (expiry-based username, HMAC password) from a shared secret, with no API call.
- Offer the Pi on 3478 UDP/TCP and Cloudflare only on TLS 443. ICE ranks UDP
  relays above TLS relays, so the Pi should win when UDP passes and Cloudflare
  should carry only UDP-blocked networks or Pi outages. Verify this ranking in a
  real test before relying on it. Caddy already owns 443 on the Pi.
- Pi work: forward 3478 UDP/TCP and a bounded relay range (for example
  50000–50199); use the existing dynamic DNS and coturn `external-ip`; carrier
  NAT would prevent inbound TURN. TLS on 5349 is optional when Cloudflare covers
  TLS.
- Hardening is required: `denied-peer-ip` for 10/8, 172.16/12, 192.168/16,
  100.64/10, loopback and link-local; `no-multicast-peers`; `user-quota`,
  `total-quota` and `bps-capacity`; no CLI/admin interface.
- Each relayed session uses home download and upload; a phone screen is roughly
  1–4 Mbps. Suitable for development, the owner's phones and testers. Public
  customer traffic through a home IP raises abuse, ISP-terms and availability
  concerns; move that to hosted TURN or a small VPS running coturn. The relay
  controls the server list, so this is a configuration change for clients.

### Cloudflare Realtime TURN

Documentation reviewed 2026-10-21 (vendor-documented, not tested here):
<https://developers.cloudflare.com/realtime/turn/> and
<https://developers.cloudflare.com/realtime/turn/generate-credentials/>.

- Anycast `turn.cloudflare.com`: TURN/UDP 3478 and 443, TURN/TCP 3478 and 80,
  TURN/TLS 5349 and 443; not on Cloudflare's China Network.
- The server keeps a long-term TURN key and calls
  `POST https://rtc.live.cloudflare.com/v1/turn/keys/<key-id>/credentials/generate-ice-servers`
  with `{"ttl": …}`; the response's `iceServers` array is passed to
  `RTCPeerConnection`. Credentials can be revoked early and refreshed with
  `setConfiguration()`.
- Listed price: free with the Realtime SFU (not needed here); otherwise
  $0.05 per real-time GB sent from Cloudflare to the client. No other free
  allowance was listed.
- Per-allocation limits around 50–100 Mbps and 5–10 kpps; bursts above them drop
  packets.

### Prototype outline

1. coturn on the Pi with the hardened configuration (dotfiles change, owner
   authorization; router forwarding by the owner).
2. Relay credential issuance for the Pi, with Cloudflare TLS behind a setting.
3. Replace the STUN-only configuration on both clients with the issued servers.
4. Measure connection success, chosen candidate and frame rate from a network
   where direct connectivity fails (for example phone on cellular, browser on a
   restrictive Wi-Fi).
