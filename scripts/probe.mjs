#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real Easee cloud API, READ ONLY, printing nothing sensitive.
//
//   node scripts/probe.mjs
//       Logs in with an invented account through the very client of the
//       integration (src/easee/client.js) and checks Easee refuses it the way
//       the integration expects (EaseeError kind "auth").
//
//   EASEE_USERNAME=... EASEE_PASSWORD=... node scripts/probe.mjs
//       Logs in with a real account, then reads (GET only) the chargers, the
//       sites, the state and settings of each charger and the state of each
//       Equalizer. It prints the SHAPE of each answer (field names and types)
//       and a few non-identifying values (operating mode, product code,
//       counts), to compare with test/fixtures/easee. Serial numbers, names,
//       addresses, tokens and the password are never printed. No command, no
//       setting is ever sent.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { createEaseeClient, EaseeError, memoryTokenStore } from '../src/easee/client.js';

const real = Boolean(process.env.EASEE_USERNAME && process.env.EASEE_PASSWORD);
const username = real
  ? process.env.EASEE_USERNAME
  : `probe-${randomBytes(6).toString('hex')}@example.invalid`;
const password = real ? process.env.EASEE_PASSWORD : randomBytes(12).toString('hex');

// Only the methods that read. The probe never holds a reference to the others.
const full = createEaseeClient({
  username,
  password,
  tokenStore: memoryTokenStore(),
  userAgent: 'gladys-easee-probe',
});
const client = {
  connect: full.connect,
  getChargers: full.getChargers,
  getProducts: full.getProducts,
  getChargerState: full.getChargerState,
  getChargerConfig: full.getChargerConfig,
  getEqualizerState: full.getEqualizerState,
};

/** Field names and types, values replaced by their type. */
function shape(value, depth = 0) {
  if (Array.isArray(value)) {
    return value.length === 0 ? [] : [shape(value[0], depth + 1), `(${value.length} items)`];
  }
  if (value && typeof value === 'object') {
    if (depth > 3) {
      return 'object';
    }
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, shape(v, depth + 1)]),
    );
  }
  return value === null ? 'null' : typeof value;
}

const print = (title, data) => console.log(`\n## ${title}\n${JSON.stringify(data, null, 2)}`);

async function step(title, fn) {
  try {
    return await fn();
  } catch (err) {
    const kind = err instanceof EaseeError ? err.kind : 'unexpected';
    console.log(`\n## ${title}\nFAILED: ${kind} (${err.status ?? '-'}) ${err.message}`);
    return undefined;
  }
}

console.log(`Easee API probe (${real ? 'real account, read only' : 'invented account'})`);

if (!real) {
  try {
    await client.connect();
    console.log('UNEXPECTED: Easee accepted an invented account.');
    process.exitCode = 1;
  } catch (err) {
    if (err instanceof EaseeError && err.kind === 'auth') {
      console.log(`OK: the login is refused as expected (HTTP ${err.status}, kind "auth").`);
    } else {
      console.log(
        `UNEXPECTED: ${err instanceof EaseeError ? err.kind : err.name} (${err.status ?? '-'}) ${err.message}`,
      );
      process.exitCode = 1;
    }
  }
} else {
  await step('login', () => client.connect());
  const chargers = (await step('GET /api/chargers', () => client.getChargers())) ?? [];
  print('GET /api/chargers (shape)', shape(chargers));
  print(
    'chargers (product codes)',
    chargers.map((c) => c.productCode),
  );
  const sites = (await step('GET /api/accounts/products', () => client.getProducts())) ?? [];
  print('GET /api/accounts/products (shape)', shape(sites));
  const equalizers = sites.flatMap((s) => s?.equalizers ?? []);
  for (const [index, charger] of chargers.entries()) {
    const state = await step(`state of charger #${index + 1}`, () =>
      client.getChargerState(charger.id),
    );
    if (state) {
      print(`GET /api/chargers/{#${index + 1}}/state (shape)`, shape(state));
      print(`charger #${index + 1} (values)`, {
        chargerOpMode: state.chargerOpMode,
        reasonForNoCurrent: state.reasonForNoCurrent,
        isOnline: state.isOnline,
        totalPower: state.totalPower,
        dynamicChargerCurrent: state.dynamicChargerCurrent,
        lifetimeEnergyType: typeof state.lifetimeEnergy,
      });
    }
    const settings = await step(`config of charger #${index + 1}`, () =>
      client.getChargerConfig(charger.id),
    );
    if (settings) {
      print(`GET /api/chargers/{#${index + 1}}/config (shape)`, shape(settings));
      print(`charger #${index + 1} settings (values)`, {
        isEnabled: settings.isEnabled,
        maxChargerCurrent: settings.maxChargerCurrent,
        detectedPowerGridType: settings.detectedPowerGridType,
      });
    }
  }
  for (const [index, equalizer] of equalizers.entries()) {
    const state = await step(`state of Equalizer #${index + 1}`, () =>
      client.getEqualizerState(equalizer.id),
    );
    if (state) {
      print(`GET /api/equalizers/{#${index + 1}}/state (shape)`, shape(state));
    }
  }
}
