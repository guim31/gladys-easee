# Easee for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for the **Easee
EV chargers** (Easee Home, Easee Charge, Charge Lite, Charge Max, Charge Up,
Charge Core, Charge Pro, Easee One) and the **Easee Equalizer**, through the
official Easee cloud API — the one the Easee app, pyeasee (Home Assistant) and
evcc use.

> **Developed without the hardware: feedback welcome.** No Easee charger nor
> account was available while writing it: the API answers come from the
> open-source clients, and the integration was tested against a fake Easee
> cloud built from them. Please
> [open an issue](https://github.com/guim31/gladys-easee/issues) with what you
> see on a real charger.

## Features

- **One device per charger**: connector status and charging state (the Gladys
  5 _charging station_ vocabulary, aligned on OCPP), the detailed Easee status,
  charging power, current per phase, session energy, **total energy** (a meter
  index the Gladys energy monitoring turns into a consumption), current limit.
- **Controls**: charging allowed (start or resume / pause), current limit
  (Easee's dynamic limit: 0 or 6 A to the charger maximum), charger enabled.
- **One device per Equalizer**: grid import and export power, current per
  phase, imported and exported energy meters.
- **Online badge**: each device shows the `cloud` transport, `unreachable`
  when Easee reports it offline.
- **Scene triggers**: _Vehicle plugged in_, _Charging completed_ (with the
  session energy).
- **Scene action**: _Control an Easee charge_ (start or resume, pause, stop).
- **Dashboard widget**: one charger with its status, live tiles and the
  buttons that fit the situation.
- Texts in English, French, German and Spanish.

Smart and solar charging stay in the Easee app or in evcc, which Gladys
already supports: the integration does not duplicate them. Unlocking the
cable is deliberately not offered.

## Requirements

- Gladys Assistant **5.1.0** or later (5.2 for the energy monitoring).
- An Easee account that owns or has access to the chargers, and internet access
  for Gladys (`api.easee.com`).

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and give
   `https://github.com/guim31/gladys-easee` (or install it from the store).
2. In its configuration, fill in the e-mail address (or phone number) and the
   password of the Easee account, the language of the device texts and the
   refresh interval, then **Test the connection**.
3. Add the chargers and the Equalizer from the **Discovery** tab.

The full documentation is in [`docs/`](docs/en.md) ([en](docs/en.md),
[fr](docs/fr.md), [de](docs/de.md), [es](docs/es.md)).

## How it works

- **Account**: `POST /api/accounts/login`, then the access token (about one
  day) is refreshed with `POST /api/accounts/refresh_token`. Both tokens are
  kept in `/data/easee-token.json` (mode 600) so a restart does not log in
  again; the password stays in the Gladys configuration. Refused credentials
  stop every request until the configuration is saved again: retrying could
  lock the account.
- **Discovery**: `GET /api/chargers` and `GET /api/accounts/products` (the
  sites, for their Equalizers). Each device is keyed on the Easee serial
  number.
- **Readings**: `GET /api/chargers/{id}/state` for each added charger,
  `GET /api/equalizers/{id}/state` for each added Equalizer, once per refresh
  interval (1, 2 or 5 minutes), and `GET /api/chargers/{id}/config` every ten
  minutes. Nothing is read for a device the user did not add.
- **Refresh**: the container runs its own timer. The core does not poll
  external devices reliably (GladysAssistant/Gladys#3198, still in 5.2.1): the
  devices are published with `should_poll` and a one-minute frequency, and the
  core's `onPoll` is only a fallback, skipped while the timer keeps up.
- **Quotas**: Easee rate-limits its API (HTTP 429). The integration only reads
  what it shows, publishes only the changed values (plus a heartbeat every 6
  hours), and on a 429 pauses for the `Retry-After` delay, 5 minutes when
  Easee does not give one.
- **Commands**: `POST /api/chargers/{id}/commands/{start,resume,pause,stop}_charging`
  and `POST /api/chargers/{id}/settings` (`dynamicChargerCurrent`,
  `enabled`). The charger is read again 10 seconds later.
- **No real-time stream**: Easee also pushes the observations over SignalR
  (`streams.easee.com`). It is not used in this first version: it could not be
  tested against the real service, and polling every minute is enough for the
  states and triggers above. See [`CLAUDE.md`](CLAUDE.md).

## Limitations

- Developed and tested without the hardware nor an account (see above).
- Cloud only; nothing works without internet or when the Easee cloud is down.
- The state is up to one refresh interval old; the total energy is updated by
  Easee about once an hour.
- Phase currents are read from the terminals of a TN grid; on an IT grid
  (Norway) the phases may be shifted.
- Not handled: smart and solar charging, schedules, RFID, cable lock, phase
  mode, Equalizer load balancing.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and an in-memory Easee cloud (`test/helpers/fakeEasee.js`) serving the
fixtures of `test/fixtures/easee/`. `test/gladys-rules.test.js` checks every
device against the feature table of the Gladys core.

`node scripts/probe.mjs` runs the real login against an invented account and
checks Easee refuses it; with `EASEE_USERNAME` and `EASEE_PASSWORD` set, it
reads (GET only) a real account and prints the shape of the answers, without
serial numbers, names or tokens.

Releases go through **Actions → Release**, which bumps the versions, rolls
[`CHANGELOG.md`](CHANGELOG.md) and builds the image. The hand-pushed tag path
of the template (`git tag vX.Y.Z && git push --tags`) still works, but only
after bumping `version` in `package.json` and in the manifest, with its
`docker_image` tag. See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [pyeasee](https://github.com/nordicopen/pyeasee) by Niklas Fondberg and
  contributors (MIT): the endpoints, the operating mode and
  `reasonForNoCurrent` codes, the Equalizer fields.
- [Easee EV Charger for Home Assistant](https://github.com/nordicopen/easee_hass)
  by Nordic Open (MIT): the units and the choice of sensors.
- The [openHAB Easee binding](https://www.openhab.org/addons/bindings/easee/)
  documentation: the polling intervals and the writable settings.
- [evcc](https://github.com/evcc-io/evcc), read only (its Easee module is not
  under an open licence, no code was copied): the start/resume logic and the
  phase terminals.
- The architecture and the conformity tests follow
  [gladys-wled](https://github.com/guim31/gladys-wled) and
  [gladys-subsonic](https://github.com/guim31/gladys-subsonic).

## Disclaimer

This project is **not affiliated with Easee**, nor endorsed or sponsored by
Easee AS. "Easee" is a trademark of its owner.

## License

[Apache-2.0](LICENSE)
