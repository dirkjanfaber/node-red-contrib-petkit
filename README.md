# node-red-contrib-petkit

Node-RED nodes for the [PetKit](https://www.petkit.com) cloud API. Poll feeder status and dispense food from your Node-RED flows. Currently targets the **Fresh Element Solo** (device type `D4`) only.

> **Disclaimer:** This project is not affiliated with, endorsed by, or in any way associated with PetKit. It is an independent, community-developed integration created by a happy user of their hardware and software. PetKit and Fresh Element Solo are trademarks of their respective owner. Use of this package is at your own risk. The underlying API is unofficial and reverse-engineered by the community - it may change or break without notice.

## Nodes

### `petkit-config`
Config node. Holds your PetKit account credentials (email, password, region) and manages the session token lifecycle.

**Region** must match the exact region name shown in the PetKit app's region/country setting (e.g. `United States`, `United Kingdom`, `Netherlands`, `China`) - getting this wrong fails login with an "unregistered email" error even with correct credentials.

**Note:** PetKit account passwords are capped at 6-14 characters. A longer password
fails login with a generic "incorrect username or password" error indistinguishable
from an actually-wrong one - if login fails unexpectedly, check that first.

### `petkit-feeder`
Polls the PetKit cloud API for Fresh Element Solo status. Emits one message per feeder:

| Property | Type | Description |
|---|---|---|
| `payload.id` | number | PetKit device ID |
| `payload.type` | string | Always `d4` for now |
| `payload.name` | string | Feeder name, as set in the PetKit app |
| `payload.serialNumber` / `payload.firmware` | string | Device serial number and firmware version |
| `payload.desc` | string | PetKit's own human-readable status line, e.g. `"Next Dispense: 17:30"` |
| `payload.settings` | object | `manualLock` (child lock), `lightMode` (indicator light), `feedSound` (dispense tone), `foodWarn` (shortage alarm) |
| `payload.state` | object | `food` (coarse ok/low indicator), `batteryPower`, `batteryStatus`, `desiccantLeftDays`, `feeding` (1 while actively dispensing) |

Send any message to the input to trigger an immediate poll. Set **Poll interval** to 0
to disable automatic polling (minimum 60s otherwise, per the PetKit API's rate limit).

### `petkit-feeder-control`
Dispenses food from, or changes a setting on, a feeder.

| Feed amount | Meaning |
|---|---|
| `10`, `20`, `30`, `40`, `50` | The only portion sizes the D4 accepts |

Both `deviceId` and `amount` can be overridden per message via `msg.payload`. If
`msg.payload.settingKey` is set instead, the node updates that setting (e.g.
`manualLock`, `lightMode`, `feedSound`, `foodWarn`) rather than feeding.

## Examples

- **`feed-on-arrival.json`** in `node-red-contrib-surepetcare`'s `examples/` directory -
  dispenses each cat's meal via `petkit-feeder-control`, triggered by arrival through
  the flap (`surepetcare-pets`). Lives there rather than here since it needs both
  packages installed either way - see its info panel for the full design.

## Reliability

Every API call - polling, feeding, or settings - automatically retries on PetKit's
server-busy errors and network errors with exponential backoff before giving up.
Session expiry triggers a single automatic re-authentication and retry.

## Installation

```bash
cd ~/.node-red
npm install node-red-contrib-petkit
```

## Configuration

1. Add a `petkit-feeder` and/or `petkit-feeder-control` node to your flow
2. Create a new **PetKit config** node with your account email, password, and region

## References

- Actively maintained reference client (Python): https://github.com/Jezza34000/py-petkit-api
- ESPHome hardware mod for this same feeder model (separate, local-only project): https://devices.esphome.io/devices/petkit-fresh-element-solo-pet-feeder/
