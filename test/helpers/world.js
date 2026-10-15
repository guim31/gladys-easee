// -----------------------------------------------------------------------------
// A test world: the SDK's fake Gladys, the fake Easee cloud, the app wired
// between them exactly as in index.js, a recording logger and a clock the
// test moves by hand. No timer runs: the tests call the refresh cycles.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createApp } from '../../src/app.js';
import { createEaseeClient, memoryTokenStore } from '../../src/easee/client.js';
import { ACCOUNT, createFakeEasee } from './fakeEasee.js';

export function createRecordingLogger() {
  const lines = [];
  const at =
    (level) =>
    (...args) =>
      lines.push({
        level,
        message: args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '),
      });
  const logger = {
    lines,
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    child: () => logger,
    at: (level) => lines.filter((line) => line.level === level).map((line) => line.message),
    clear: () => lines.splice(0),
  };
  return logger;
}

/**
 * @param {object} [options]
 * @param {object} [options.config] configuration of the integration
 * @param {boolean} [options.created] the user added every discovered device
 * @param {boolean} [options.connect] connect at once
 * @param {boolean} [options.timers] run the app's own refresh timer
 */
export async function createWorld({
  config = {},
  created = true,
  connect = true,
  timers = false,
} = {}) {
  const easee = createFakeEasee();
  const clock = { now: Date.parse('2026-10-14T18:43:00Z') };
  const logger = createRecordingLogger();
  const laters = [];
  const tokenStore = memoryTokenStore();
  const gladys = createFakeGladys({ config: { ...ACCOUNT, ...config } });
  const app = createApp({
    gladys,
    logger,
    timers,
    now: () => clock.now,
    later: (fn) => laters.push(fn),
    createClient: (cfg) =>
      createEaseeClient({
        username: cfg.username,
        password: cfg.password,
        fetch: easee.fetch,
        tokenStore,
        now: () => clock.now,
      }),
  });
  app.register();

  const world = {
    gladys,
    app,
    easee,
    logger,
    clock,
    laters,
    tokenStore,
    /** Move the clock. */
    advance(ms) {
      clock.now += ms;
    },
    /** Run the delayed refreshes the commands asked for. */
    async runLaters() {
      for (const fn of laters.splice(0)) {
        await fn();
      }
    },
    /** The user adds every discovered device to Gladys. */
    async addAll() {
      for (const device of gladys.fake.discoveredDevices) {
        await gladys.fake.deviceCreated(device);
      }
    },
    device(type, id) {
      const externalId = gladys.externalIds(type, id).device;
      return (
        gladys.fake.devices.find((d) => d.external_id === externalId) ??
        gladys.fake.discoveredDevices.find((d) => d.external_id === externalId)
      );
    },
    state(type, id, key) {
      return gladys.fake.lastState(gladys.externalIds(type, id).feature(key));
    },
  };

  if (connect) {
    await gladys.connect();
    if (created) {
      await world.addAll();
    }
  }
  return world;
}
