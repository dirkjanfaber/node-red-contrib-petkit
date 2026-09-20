# node-red-contrib-petkit

A Node-RED node package for interacting with PetKit's cloud API. First target: the
**Fresh Element Solo** smart feeder (device type `D4` in PetKit's API). This is a sibling
project to `node-red-contrib-surepetcare` and follows the same conventions.

## Project goals

- Implement Node-RED nodes for the PetKit cloud API, starting with the Fresh Element
  Solo (D4) feeder only
- TypeScript implementation, compiled to JS for Node-RED runtime
- Get the feeder working end-to-end via the cloud API *before* opening the device up for
  a local ESPHome-based hardware mod (see `../cat-feeder` — that project replaces the
  feeder's mainboard entirely, at which point control would go through ESPHome/MQTT
  directly rather than this package). Because of that, there is no near-term need for a
  pluggable local-backend interface the way `sureflap-api.ts` supports a future
  PetHubLocal client — a hardware mod on this feeder bypasses this package rather than
  swapping a transport underneath it. Keep the API client isolated from Node-RED
  regardless, for testability.
- Publish as `node-red-contrib-petkit` on npm

## Architecture

### Nodes to implement

1. **`petkit-config`** — config node, handles credentials (email, password, region) +
   session token lifecycle
2. **`petkit-feeder`** — polls Fresh Element Solo status, emits a message per feeder
3. **`petkit-feeder-control`** — manual feed (dispense) and setting changes (child lock,
   indicator light, feed tone) for a feeder

### Directory structure

```
node-red-contrib-petkit/
├── src/
│   ├── nodes/
│   │   ├── petkit-config/
│   │   │   ├── petkit-config.ts
│   │   │   └── petkit-config.html
│   │   ├── petkit-feeder/
│   │   │   ├── petkit-feeder.ts
│   │   │   └── petkit-feeder.html
│   │   └── petkit-feeder-control/
│   │       ├── petkit-feeder-control.ts
│   │       └── petkit-feeder-control.html
│   ├── lib/
│   │   └── petkit-api.ts   ← API client, isolated from Node-RED
│   ├── types/
│   │   └── petkit.d.ts     ← shared types
│   └── __tests__/
├── dist/                     ← compiled output (gitignored)
├── package.json
├── tsconfig.json
└── CLAUDE.md
```

## PetKit API

Unofficial and undocumented — reverse-engineered by the community. Unlike SurePetcare's
API, PetKit's is region-sharded and uses a `application/x-www-form-urlencoded` body
with a mutable session token rather than a bearer token. **Confirmed live against a
real account on 2026-09-20** (region: Netherlands) — see Notes for how the initial
assumptions (sourced from a stale reference client) turned out to differ.

### Regions

```
POST https://passport.petkt.com/6/account/regionservers
(empty body)
```

Response: `{ result: { list: [ { name, id, gateway, accountType }, ... ] } }` — **one
entry per country** (confirmed: "Netherlands", "Afghanistan", "Albania", ... individually,
not one entry per broad region), each with:
- `id`: a 2-letter ISO country code, e.g. `"NL"` — sent back on login **lowercased**
  (`"nl"`); the uppercase value from this response is rejected
- `gateway`: the base URL for that country's shard — many countries share the same
  gateway (confirmed shards: `api.eu-pet.com` for Europe, `api.petkt.com` for the
  Americas/international, `api.petktasia.com` for Asia; China is a special case, see
  below)

- Cache the resolved base URL and lowercased region id in the config node instance
  alongside the token — region is a per-account setting, not something to redetect on
  every call
- China is reached via a fixed base URL (`https://api.petkit.cn/6/`) rather than the
  gateway this endpoint would return for it — **unverified**, no China account was
  available to test; this is carried over from the reference client unchanged

### Authentication

```
POST {base_url}user/login
Content-Type: application/x-www-form-urlencoded

oldVersion=13.2.1&client=<CLIENT_DICT as literal Python-dict-style string>&encrypt=1
&region=<lowercased 2-letter region id>&username=<email>&password=<md5(password) hex>
```

Confirmed-working client fingerprint (Android/`okhttp`, current as of a library last
updated 2026-09-16 — see References). An older iOS fingerprint from a stale reference
client (last updated Jan 2025) was tried first and got the same "incorrect password"
result the live app gave for the same, at-the-time-actually-wrong password — so it's
unconfirmed whether the fingerprint itself ever mattered here, only that *this* one is
proven end-to-end:

```
Headers: Accept: */*, Accept-Language: en-US;q=1, it-US;q=0.9, Accept-Encoding: gzip,
deflate, Content-Type: application/x-www-form-urlencoded, User-Agent: okhttp/3.14.9,
X-Img-Version: 1, X-Locale: en-US, X-Client: android(16.1;23127PN0CG), X-Hour: 24,
X-Api-Version: 13.2.1
(session-authenticated requests add: X-Session, F-Session, X-TimezoneId, X-Timezone)

CLIENT_DICT (the "client" field's contents): locale, name, osVersion, phoneBrand,
platform, source, version, timezoneId, timezone (numeric UTC offset as a string, e.g.
"2.0" — computed from the account's IANA timezone, not hardcoded)
```

- **PetKit account passwords are capped at 6-14 characters** — sending a longer one
  doesn't get rejected client-side, it just fails login with the generic error 122
  ("incorrect username or password") indistinguishable from an actually-wrong password.
  This cost real debugging time; there's no clean way to detect it before the fact, but
  it's worth remembering as the first thing to check on a 122.
- Response: `{ result: { session: { id, userId, expiresIn }, apiServers: [...], ... } }`
  — `apiServers` looks like it *should* replace `base_url` for subsequent calls but the
  reference client never uses it and everything works fine continuing to use the
  original gateway URL; left alone
- `session.id` is the token, used as **both** `X-Session` and `F-Session` headers on
  every subsequent request
- `session.expiresIn` is in seconds — cache `Date.now() + expiresIn * 1000` and
  re-authenticate proactively before it lapses, same pattern as
  `surepetcare-api.ts`'s `TOKEN_TTL_MS`
- Password is sent as a bare MD5 hex digest, not hashed+salted client-side beyond that —
  this is PetKit's scheme, not a design choice available to us

### Households / groups

```
POST {base_url}group/family/list
Authorization headers only, empty body
```

Response: `{ result: [ { groupId, ... }, ... ] }`

- An account can belong to multiple groups/households; poll devices per group

### Devices (feeders)

```
POST {base_url}discovery/device_roster_v2
{ day: "YYYYMMDD", groupId }
```

Response: `{ result: { devices: [ { id, type, ... } ], hasRelay } }`

- `type` is the short device code (`D3`, `D4`, `D4s`, `Feeder`, `FeederMini`, ...) — we
  only care about `D4` (Fresh Element Solo) for now
- Use this to discover feeder IDs, then fetch full state per device:

```
POST {base_url}d4/device_detail
{ id: deviceId }
```

Response shape **confirmed against two real D4 devices** (fields actually mapped into
`Feeder` are in `src/types/petkit.d.ts`; the raw response has much more, e.g. wifi
info, full feeding schedule (`multiFeedItem`) — left unmapped until a node needs them):

```
{ result: {
    id, name, sn (serial number), firmware, desc ("Next Dispense: HH:MM"),
    settings: { manualLock, lightMode, feedSound, foodWarn, ...more },
    state: { food, batteryPower, batteryStatus, desiccantLeftDays, feeding,
             feedState, ...more },
} }
```

- `state.food` was observed as `1` on both (well-stocked) real devices — likely a
  coarse ok/low indicator rather than a precise level; unconfirmed against an actually
  empty hopper
- `state.feedState` is **per device, not per cat** — PetKit has no way to know which
  cat ate from which bowl, only what each physical feeder dispensed:
  ```
  feedState: { realAmountTotal, planAmountTotal, addAmountTotal, planRealAmountTotal,
               times, feedTimes: { [secondsSinceMidnight: string]: count } }
  ```
  `realAmountTotal` = `planRealAmountTotal` (from the schedule) + `addAmountTotal`
  (manual/extra dispenses, including ones triggered via `feedNow`). Whether this
  resets daily or accumulates since the schedule was configured is **unconfirmed** —
  observed `feedTimes` counts greater than 1 on slots that should only fire once/day
  suggest it may not be a clean "today" window; treat it as informative rather than
  authoritative until verified over multiple days

### Manual feed (dispense)

```
POST {base_url}d4/saveDailyFeed
{ amount, day: "YYYYMMDD", deviceId, time: "-1" }
```

- `amount` for D4 (Fresh Element Solo) must be one of `10, 20, 30, 40, 50` (grams,
  presumably — reference client doesn't say, treat as opaque device units and confirm
  against the app before exposing a different unit to users)
- Validate `amount` against that allow-list client-side before calling — PetKit's error
  response for an invalid amount hasn't been characterized yet

### Settings

```
POST {base_url}d4/updateSettings
{ id: deviceId, kv: JSON.stringify({ [settingKey]: value }) }
```

Setting keys confirmed present in a real D4 `device_detail.settings` (the reference
client's generic `FeederSetting` enum included a `feedTone` key that doesn't actually
appear on D4 — dropped from the table below):

| Key | Meaning |
|-----|---------|
| `manualLock` | child lock |
| `lightMode` | indicator light |
| `feedSound` | dispense tone |
| `foodWarn` | shortage alarm (paired with `foodWarnRange`, not yet exposed) |

Other real keys seen but not yet wired up to any node: `feedNotify`, `foodNotify`,
`lowBatteryNotify`, `desiccantNotify`, `lightRange`, `factor`, `lightConfig`,
`lightMultiRange`, `colorSetting`, `controlSettings`.

### Error handling

- PetKit returns app-level error codes in the response body rather than always using
  HTTP status codes — known codes from the reference client:
  - `122`: bad username/password
  - `5`: session expired / account signed in elsewhere — re-authenticate and retry once
  - `125`: unregistered email for the selected region — surface as a config error, don't
    retry
  - `1`, `99`: PetKit server busy/maintenance — treat like a 429, backoff and retry
- Mirror `surepetcare-api.ts`'s `withRetry`: exponential backoff (`[1000, 3000, 9000]`
  ms, configurable via constructor `retryDelays` option) for rate-limited/network/server
  errors, single re-authenticate-and-retry for session-expired
- Network errors that exhaust retries, and any other unrecoverable error: emit Node-RED
  status error via `node.error()`, do not crash
- Don't poll more often than every 60s per device, same rationale as the SurePetcare
  package

## Node-RED conventions to follow

(identical to `node-red-contrib-surepetcare`)

- Config nodes hold credentials and shared state (token, base URL, group/device list)
- All nodes must accept `msg.payload` overrides where relevant
- Use `node.status()` to show connection state (green=ok, yellow=connecting, red=error)
- Emit errors via `node.error(err, msg)` — not `throw`
- Register nodes in `package.json` under `"node-red": { "nodes": { ... } }`
- HTML files must use Node-RED's `<script type="text/javascript">` +
  `RED.nodes.registerType` pattern

## API client design (`petkit-api.ts`)

Keep the API client independent of Node-RED so it can be tested standalone.

```typescript
interface PetkitBackend {
  authenticate(): Promise<void>
  getFeeders(): Promise<Feeder[]>
  feedNow(deviceId: number, amount: number): Promise<void>
  updateFeederSetting(deviceId: number, key: string, value: number): Promise<void>
}
```

Implement `PetkitCloudAPI implements PetkitBackend`. Unlike the SurePetcare package,
there's no planned second implementation of this interface (see Project goals) — the
interface exists purely to keep the Node-RED node logic decoupled from the HTTP client
for testing, matching the shape of `SureflapBackend` for consistency across the two
packages.

## TypeScript setup

Same as `node-red-contrib-surepetcare`:

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true
  }
}
```

Dependencies:
- `axios` for HTTP

Dev dependencies:
- `typescript`, `@types/node`
- `jest`, `ts-jest`, `axios-mock-adapter`
- `node-red-node-test-helper`, `@types/node-red-node-test-helper`
- `node-red` (peer, for local dev/testing)

## Testing & TDD

Development follows strict TDD: **write the test first, then implement**.

### Workflow

1. Write a failing test that describes the desired behaviour
2. Run the test suite — confirm it fails for the right reason
3. Write the minimal implementation to make it pass
4. Refactor, keeping tests green
5. Repeat

Never write implementation code without a failing test to justify it.

### Test structure

```
src/
└── __tests__/
    ├── petkit-api.test.ts              ← API client unit tests (mock HTTP)
    ├── petkit-feeder.test.ts           ← Node-RED node tests (test-helper)
    └── petkit-feeder-control.test.ts   ← Node-RED node tests (test-helper)
```

### Running tests

```bash
npm test              # run all tests
npm test -- --watch   # watch mode during development
npm test -- --coverage
```

### Coverage targets

| Area | Target |
|------|--------|
| API client | 100% |
| Node logic | ≥ 90% |
| Error paths (session expiry, rate limit, network) | 100% |

## References

- Reference cloud API implementations (Python, both MIT licensed):
  - https://github.com/Jezza34000/py-petkit-api — actively maintained (updated within
    days as of this writing); the confirmed-working Android client fingerprint,
    per-country region list shape, and current endpoint constants in this file came
    from its `pypetkitapi/client.py`, `const.py`, and `utils.py`
  - https://github.com/RobertD502/petkitaio — stale (last pushed Jan 2025); used for
    the initial protocol sketch before live testing exposed several of its assumptions
    as outdated (numeric region ids, iOS fingerprint, no per-country region list) — see
    Notes
- ESPHome hardware mod for this same feeder model (separate project, local-only,
  bypasses this package) — `../cat-feeder/DESIGN.md`
- Style/conventions reference — `../node-red-contrib-surepetcare/CLAUDE.md`

## Notes

- Confirmed end-to-end against a real account on 2026-09-20 (2 real D4 feeders polled
  successfully). Corrections made after live testing, vs. the initial reference-client
  read: region ids are per-country 2-letter codes sent lowercased (not the numeric ids
  `petkitaio` used), the working client fingerprint is the current Android one from
  `py-petkit-api` rather than `petkitaio`'s stale iOS one, and `device_detail`'s real
  shape is far richer than initially guessed (see Devices section above).
- `region` must be resolved via `regionservers` before login; don't hardcode a base URL
  per account, since the correct region is account-specific
- A `.petkit-credentials.json` file (gitignored) at the repo root holds real test
  credentials for the `scripts/smoke-test.js` / `scripts/debug-*.js` ad-hoc scripts used
  during live verification — never commit it, never hardcode credentials elsewhere
