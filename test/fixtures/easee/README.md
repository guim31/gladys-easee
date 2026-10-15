# Easee API fixtures

Answers of the Easee cloud API (`https://api.easee.com`) used by the tests.

No published capture of a real answer could be found: pyeasee and the Home
Assistant integration (MIT) ship no recorded responses, and the session that
wrote this integration could not reach the API. These files are therefore
**reconstructed** from the field names and types the maintained clients read:

- `pyeasee` (`charger.py`, `site.py`, `const.py`): the endpoints, the
  `chargerOpMode` and `reasonForNoCurrent` codes, the Equalizer fields;
- the Home Assistant integration `easee_hass` (`const.py`): the units (kW,
  kWh, A);
- the openHAB binding documentation: the charger channels;
- evcc (read only, its Easee module is not under an open licence): the
  charger state and config fields.

Every identifier is invented (`EH000001`, `QP000003`, site `100001`), as are
the names, the address, the Wi-Fi name and the tokens. The values are
plausible for a three-phase 11 kW charge on a TN grid.

| File                   | Endpoint                                   |
| ---------------------- | ------------------------------------------ |
| `login-ok.json`        | `POST /api/accounts/login` (200)           |
| `login-refused.json`   | `POST /api/accounts/login` (400, code 100) |
| `chargers.json`        | `GET /api/chargers`                        |
| `products.json`        | `GET /api/accounts/products`               |
| `charger-state-*.json` | `GET /api/chargers/{id}/state`             |
| `charger-config.json`  | `GET /api/chargers/{id}/config`            |
| `equalizer-state.json` | `GET /api/equalizers/{id}/state`           |

`scripts/probe.mjs` checks the real login against a fake account; run with a
real account (read only), it prints the shape of these answers without their
values, so the fixtures can be compared with the real API.
