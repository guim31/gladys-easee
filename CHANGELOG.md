# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Easee chargers in Gladys, through the Easee cloud API: one device per
  charger with its connector status, charging state, detailed Easee status,
  charging power, current per phase, session energy and total energy (a meter
  index for the Gladys energy monitoring).
- Charge controls: charging allowed (start or resume / pause), current limit
  (0 or 6 A to the charger maximum) and charger enabled.
- The Easee Equalizer as a device: grid import and export power, current per
  phase, imported and exported energy.
- A `cloud` / `unreachable` badge on each device, following its connection.
- Scene triggers _Vehicle plugged in_ and _Charging completed_, and the scene
  action _Control an Easee charge_ (start or resume, pause, stop).
- The _Easee charger_ dashboard widget: status, power, session energy, current
  limit and the start, pause and stop buttons.
- A _Test the connection_ button in the configuration.
- The integration refreshes the devices itself every 1, 2 or 5 minutes,
  respects the Easee rate limit and keeps its login token in `/data`.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-easee/commits/main
