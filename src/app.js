// -----------------------------------------------------------------------------
// The integration: the Easee account, its devices, the refresh timer, the
// commands, the scene triggers and actions, the widget.
//
// Everything Gladys calls is registered here on the Gladys client it is given
// (the real one in index.js, the SDK's fake Gladys in the tests), so the tests
// run the very code the container runs.
//
// Refresh: the core cannot be trusted to poll an external device
// (Gladys#3198, still there in 5.2.1), so the container reads the Easee cloud
// itself, every `poll_interval` seconds, for the devices the user added. The
// core's onPoll is a fallback that does nothing while the timer keeps up.
// Easee rate-limits its API: one reading of the state per device and per
// period, the charger settings every ten minutes, and a 429 pauses
// everything for the delay Easee asks (5 minutes when it does not say).
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { isConfigured, normalizeConfig, pollPeriodMs } from './config.js';
import { createEaseeClient, EaseeError } from './easee/client.js';
import {
  OP_MODE,
  hasVehicle,
  isOnline,
  maxChargerCurrent,
  opModeOf,
  statusKey,
  transitions,
} from './easee/model.js';
import {
  CHARGER_FEATURE,
  DEVICE_TYPE,
  buildChargerDevice,
  buildEqualizerDevice,
  chargerStates,
  equalizerStates,
  parseExternalId,
} from './devices.js';
import { MESSAGES, STATUS, TEXT, pick, thrown } from './i18n.js';
import { createIssueLog } from './issues.js';

export const WIDGET_KEY = 'charger';
export const SCENE_TRIGGERS = ['vehicle_connected', 'charging_completed'];
export const SCENE_ACTION_KEY = 'charger_command';
export const CHARGER_COMMANDS = ['start', 'pause', 'stop'];

/** Re-send an unchanged value this often, so Gladys never sees it as stale. */
export const HEARTBEAT_MS = 6 * 60 * 60 * 1000;
/** The charger settings (enabled, maximum current) change rarely. */
const CONFIG_PERIOD_MS = 10 * 60 * 1000;
/** Pause after a 429 that does not say how long. */
const RATE_LIMIT_PAUSE_MS = 5 * 60 * 1000;
/** Read a charger again this long after a command, to show its effect. */
const COMMAND_REFRESH_MS = 10 * 1000;

/**
 * @param {object} options
 * @param {object} options.gladys GladysIntegration or the SDK's fake Gladys
 * @param {{ debug: Function, info: Function, warn: Function, error: Function }} options.logger
 * @param {(config: object) => ReturnType<typeof createEaseeClient>} [options.createClient]
 * @param {boolean} [options.timers] run the refresh timer (the tests drive the cycles)
 * @param {(fn: Function, ms: number) => void} [options.later] delayed refresh after a command
 * @param {() => number} [options.now]
 */
export function createApp({
  gladys,
  logger,
  createClient = (config) =>
    createEaseeClient({ username: config.username, password: config.password }),
  timers = true,
  later = (fn, ms) => setTimeout(fn, ms).unref?.(),
  now = () => Date.now(),
}) {
  const issues = createIssueLog(logger);
  let config = normalizeConfig();
  let client = null;
  /** Easee refused the credentials: nothing is retried until the config changes. */
  let authRefused = false;
  /** The products of the account, known once discovered. */
  let products = null;
  let pausedUntil = 0;
  /** The last error of the account as a whole, for the connection test. */
  let lastAccountError = null;
  let timer = null;
  let stopped = true;
  let cloudOk = null;
  // Per Easee id:
  const readings = new Map(); // charger id -> { state, config, at }
  const configReadAt = new Map();
  const lastMode = new Map();
  const highestIndex = new Map(); // feature external id -> kWh (meters never go back)
  const transport = new Map(); // device external id -> published transport
  const lastPolledAt = new Map(); // device external id -> ms
  const inFlight = new Map();

  // --- Account ---------------------------------------------------------------

  function credentialsOf(cfg) {
    return `${cfg.username}\n${cfg.password}`;
  }

  async function setup() {
    products = null;
    if (!isConfigured(config)) {
      client = null;
      logger.info('Not configured yet: waiting for the Easee account');
      await gladys.setConnectionStatus(false, TEXT.notConfigured);
      return false;
    }
    if (authRefused) {
      await gladys.setConnectionStatus(false, TEXT.authRefused);
      return false;
    }
    client ??= createClient(config);
    try {
      await discover();
    } catch (err) {
      await reportAccountError(err);
      return false;
    }
    return true;
  }

  async function discover() {
    await client.connect();
    const chargers = (await client.getChargers()).filter((c) => c && c.id);
    let equalizers = [];
    try {
      const sites = await client.getProducts();
      equalizers = sites.flatMap((site) => site?.equalizers ?? []).filter((e) => e && e.id);
    } catch (err) {
      if (err instanceof EaseeError && err.kind === 'auth') {
        throw err;
      }
      // The sites are only needed for the Equalizers: the chargers go on.
      logger.debug(`Reading the sites failed (${err.message}): no Equalizer this time`);
    }
    for (const charger of chargers) {
      if (!readings.get(charger.id)?.config) {
        try {
          const settings = await client.getChargerConfig(charger.id);
          configReadAt.set(charger.id, now());
          readings.set(charger.id, { ...readings.get(charger.id), config: settings });
        } catch (err) {
          logger.debug(`Reading the settings of ${charger.id} failed (${err.message})`);
        }
      }
    }
    products = {
      chargers: new Map(chargers.map((c) => [String(c.id), c])),
      equalizers: new Map(equalizers.map((e) => [String(e.id), e])),
    };
    await gladys.publishDiscoveredDevices(buildDevices());
    if (cloudOk !== true) {
      logger.info(
        `Connected to Easee: ${chargers.length} charger(s), ${equalizers.length} Equalizer(s)`,
      );
    }
    cloudOk = true;
    await gladys.setConnectionStatus(true);
  }

  function buildDevices() {
    if (!products) {
      return [];
    }
    return [
      ...[...products.chargers.values()].map((charger) =>
        buildChargerDevice(gladys, charger, {
          language: config.language,
          maxCurrent: maxChargerCurrent(readings.get(String(charger.id))?.config),
        }),
      ),
      ...[...products.equalizers.values()].map((equalizer) =>
        buildEqualizerDevice(gladys, equalizer, { language: config.language }),
      ),
    ];
  }

  /** An error of the account as a whole (login, cloud down, rate limit). */
  async function reportAccountError(err) {
    lastAccountError = err;
    if (err instanceof EaseeError && err.kind === 'auth') {
      if (!authRefused) {
        logger.warn('Easee refused the credentials: fix them in the configuration');
      }
      authRefused = true;
      cloudOk = false;
      await gladys.setConnectionStatus(false, TEXT.authRefused);
      return;
    }
    if (err instanceof EaseeError && err.kind === 'rate_limit') {
      pausedUntil = now() + (err.retryAfterMs ?? RATE_LIMIT_PAUSE_MS);
      issues.fail('rate_limit', `Easee rate limit reached: paused until ${iso(pausedUntil)}`);
      return;
    }
    issues.fail('cloud', `Easee cloud unreachable (${err.message})`);
    if (cloudOk !== false) {
      cloudOk = false;
      await gladys.setConnectionStatus(false, MESSAGES.unreachable(err.message));
    }
  }

  async function cloudWorks() {
    issues.ok('cloud', 'Easee cloud reachable again');
    issues.ok('rate_limit', 'Easee rate limit over');
    if (cloudOk === false) {
      cloudOk = true;
      await gladys.setConnectionStatus(true);
    }
  }

  // --- Readings --------------------------------------------------------------

  /** The devices the user added to Gladys, with what they are on Easee. */
  function createdDevices() {
    return (gladys.devices ?? [])
      .map((device) => ({ device, ref: parseExternalId(gladys, device.external_id) }))
      .filter(({ ref }) => ref);
  }

  /** Meter indexes never go back: a lower reading of the cloud is dropped. */
  function monotonic(states) {
    return states.filter((s) => {
      if (!/:(lifetime_energy|import_index|export_index)$/.test(s.device_feature_external_id)) {
        return true;
      }
      const highest = highestIndex.get(s.device_feature_external_id);
      if (highest !== undefined && s.state < highest) {
        logger.debug(`${s.device_feature_external_id}: ${s.state} < ${highest}, dropped`);
        return false;
      }
      highestIndex.set(s.device_feature_external_id, s.state);
      return true;
    });
  }

  async function publishTransport(externalId, online) {
    const value = online ? DEVICE_TRANSPORTS.CLOUD : DEVICE_TRANSPORTS.UNREACHABLE;
    if (transport.get(externalId) === value) {
      return;
    }
    transport.set(externalId, value);
    await gladys.publishTransports([{ external_id: externalId, transport: value }]);
  }

  async function readCharger(id, { forceConfig = false } = {}) {
    const ids = gladys.externalIds(DEVICE_TYPE.CHARGER, id);
    const state = await client.getChargerState(id);
    const previous = readings.get(id) ?? {};
    let settings = previous.config ?? null;
    const configAge = now() - (configReadAt.get(id) ?? -Infinity);
    if (forceConfig || !settings || configAge >= CONFIG_PERIOD_MS) {
      try {
        settings = await client.getChargerConfig(id);
        configReadAt.set(id, now());
      } catch (err) {
        if (err instanceof EaseeError && (err.kind === 'auth' || err.kind === 'rate_limit')) {
          throw err;
        }
        logger.debug(`${id}: reading the settings failed (${err.message})`);
      }
    }
    readings.set(id, { state, config: settings, at: now() });

    await gladys.publishChangedStates(
      monotonic(chargerStates(ids, state, settings, config.language)),
      { heartbeat: HEARTBEAT_MS },
    );

    const online = isOnline(state);
    if (transport.has(ids.device) && (transport.get(ids.device) === 'cloud') !== online) {
      logger.info(`${chargerName(id)}: ${online ? 'back online' : 'offline'}`);
    }
    await publishTransport(ids.device, online);

    const mode = opModeOf(state);
    const events = transitions(lastMode.get(id), mode);
    if (mode !== null) {
      lastMode.set(id, mode);
    }
    for (const key of events) {
      logger.debug(`${id}: scene event ${key}`);
      await gladys
        .publishSceneEvent(key, {
          charger: ids.device,
          charger_name: chargerName(id),
          session_energy: Number(state.sessionEnergy) || 0,
        })
        .catch((err) => logger.warn(`Scene event ${key} refused: ${err.message}`));
    }
    if (events.length > 0 || previous.state?.chargerOpMode !== state.chargerOpMode) {
      gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  async function readEqualizer(id) {
    const ids = gladys.externalIds(DEVICE_TYPE.EQUALIZER, id);
    const state = await client.getEqualizerState(id);
    await gladys.publishChangedStates(monotonic(equalizerStates(ids, state)), {
      heartbeat: HEARTBEAT_MS,
    });
    await publishTransport(ids.device, state?.isOnline !== false);
  }

  function chargerName(id) {
    return products?.chargers.get(id)?.name || id;
  }

  /**
   * Read one device, unless it was read less than `minGap` periods ago.
   * Errors are logged once while they last; the account-wide ones (refused
   * credentials, rate limit) stop the cycle.
   */
  async function pollDevice(device, ref, { force = false, minGap = 0.5 } = {}) {
    const key = device.external_id;
    if (inFlight.has(key)) {
      return inFlight.get(key);
    }
    const last = lastPolledAt.get(key);
    if (!force && last !== undefined && now() - last < pollPeriodMs(config) * minGap) {
      logger.debug(`${key}: read ${now() - last} ms ago, skipped`);
      return undefined;
    }
    lastPolledAt.set(key, now());
    const run = (async () => {
      try {
        if (ref.type === DEVICE_TYPE.CHARGER) {
          await readCharger(ref.id);
        } else {
          await readEqualizer(ref.id);
        }
        issues.ok(key, `${ref.type} ${ref.id}: readings work again`);
        await cloudWorks();
      } catch (err) {
        if (err instanceof EaseeError && ['auth', 'rate_limit', 'network'].includes(err.kind)) {
          await reportAccountError(err);
          throw err;
        }
        issues.fail(key, `${ref.type} ${ref.id}: reading failed (${err.message})`);
        await publishTransport(key, false).catch(() => {});
      }
    })();
    inFlight.set(key, run);
    try {
      return await run;
    } finally {
      inFlight.delete(key);
    }
  }

  /** Can the cloud be read now? Sets the account up again when needed. */
  async function ready() {
    if (gladys.connected === false || authRefused || !isConfigured(config)) {
      return false;
    }
    if (now() < pausedUntil) {
      logger.debug(`Rate limited: no reading before ${iso(pausedUntil)}`);
      return false;
    }
    if (!products) {
      return setup();
    }
    return true;
  }

  /** One refresh of every added device. Never throws. */
  async function cycle({ force = false } = {}) {
    try {
      if (!(await ready())) {
        return;
      }
      for (const { device, ref } of createdDevices()) {
        try {
          await pollDevice(device, ref, { force });
        } catch {
          // Account-wide error, already reported: the next devices would fail too.
          return;
        }
      }
    } catch (err) {
      logger.error(`Refresh cycle failed (${err.message})`);
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!timers || stopped) {
      return;
    }
    timer = setTimeout(async () => {
      timer = null;
      await cycle();
      schedule();
    }, pollPeriodMs(config));
    timer.unref?.();
  }

  // --- Commands ----------------------------------------------------------------

  function translateError(err) {
    if (!(err instanceof EaseeError)) {
      return err;
    }
    const text = {
      auth: TEXT.authRefused,
      rate_limit: TEXT.rateLimited,
      network: TEXT.cloudUnreachable,
      server: TEXT.cloudUnreachable,
    }[err.kind];
    return new Error(text ? thrown(text) : `${thrown(TEXT.commandRefused)} (HTTP ${err.status})`);
  }

  function chargerIdOf(externalId) {
    const ref = parseExternalId(gladys, externalId);
    if (!ref || ref.type !== DEVICE_TYPE.CHARGER) {
      throw new Error(thrown(TEXT.unknownCharger));
    }
    return ref.id;
  }

  async function withClient(fn) {
    if (!isConfigured(config) || authRefused) {
      throw new Error(thrown(authRefused ? TEXT.authRefused : TEXT.notConfiguredShort));
    }
    client ??= createClient(config);
    try {
      return await fn(client);
    } catch (err) {
      if (err instanceof EaseeError && ['auth', 'rate_limit'].includes(err.kind)) {
        await reportAccountError(err);
      }
      throw translateError(err);
    }
  }

  /** Read the charger again a little later, so Gladys shows the effect. */
  function refreshSoon(id) {
    later(async () => {
      try {
        if (await ready()) {
          await readCharger(id, { forceConfig: true });
        }
      } catch (err) {
        logger.debug(`${id}: refresh after the command failed (${err.message})`);
      }
    }, COMMAND_REFRESH_MS);
  }

  /** The current mode, read now when no reading is known. */
  async function currentMode(api, id) {
    if (!readings.get(id)?.state) {
      readings.set(id, { ...readings.get(id), state: await api.getChargerState(id) });
    }
    return opModeOf(readings.get(id).state);
  }

  /**
   * start (start or resume, whichever the charger needs), pause or stop.
   * @returns {Promise<string>} the Easee command sent
   */
  async function chargerCommand(id, command) {
    if (!CHARGER_COMMANDS.includes(command)) {
      throw new Error(`Unknown command ${command}`);
    }
    return withClient(async (api) => {
      const mode = await currentMode(api, id);
      if (!hasVehicle(mode)) {
        throw new Error(thrown(TEXT.noVehicle));
      }
      let name = `${command}_charging`;
      if (command === 'start') {
        name = mode === OP_MODE.AWAITING_AUTHORIZATION ? 'start_charging' : 'resume_charging';
      }
      logger.info(`${chargerName(id)}: ${name}`);
      await api.command(id, name);
      refreshSoon(id);
      return name;
    });
  }

  async function onSetValue(device, feature, value) {
    const id = chargerIdOf(device.external_id);
    const key = feature.external_id.slice(device.external_id.length + 1);
    if (key === CHARGER_FEATURE.CHARGE) {
      await chargerCommand(id, Number(value) === 1 ? 'start' : 'pause');
      return;
    }
    if (key === CHARGER_FEATURE.TARGET_CURRENT) {
      const amps = Math.round(Number(value));
      const max = maxChargerCurrent(readings.get(id)?.config);
      // Easee takes 0 (no current) or 6 A and more: below 6 A a vehicle may not charge.
      if (!Number.isFinite(amps) || (amps !== 0 && (amps < 6 || amps > max))) {
        throw new Error(thrown(TEXT.badCurrent));
      }
      await withClient(async (api) => {
        logger.info(`${chargerName(id)}: current limit ${amps} A`);
        await api.setSettings(id, { dynamicChargerCurrent: amps });
      });
      await gladys.publishState(feature.external_id, amps);
      refreshSoon(id);
      return;
    }
    if (key === CHARGER_FEATURE.ENABLED) {
      const enabled = Number(value) === 1;
      await withClient(async (api) => {
        logger.info(`${chargerName(id)}: ${enabled ? 'enabled' : 'disabled'}`);
        await api.setSettings(id, { enabled });
      });
      await gladys.publishState(feature.external_id, enabled ? 1 : 0);
      refreshSoon(id);
      return;
    }
    throw new Error(`${feature.external_id} cannot be controlled`);
  }

  // --- Widget ------------------------------------------------------------------

  function widgetContent({ settings, language }) {
    const lang = language ?? config.language;
    const text = (t) => pick(t, lang);
    const message = (t) => ({ ttl_seconds: 300, components: [{ type: 'text', text: text(t) }] });
    if (!isConfigured(config)) {
      return message(TEXT.notConfigured);
    }
    if (!settings?.device) {
      return message(TEXT.pickCharger);
    }
    const ref = parseExternalId(gladys, settings.device);
    if (!ref || ref.type !== DEVICE_TYPE.CHARGER) {
      return message(TEXT.notACharger);
    }
    const ids = gladys.externalIds(DEVICE_TYPE.CHARGER, ref.id);
    const state = readings.get(ref.id)?.state;
    if (!state) {
      return message(TEXT.noReadingYet);
    }
    const mode = opModeOf(state);
    const online = isOnline(state);
    const statusColor =
      mode === OP_MODE.CHARGING
        ? WIDGET_COLORS.SUCCESS
        : mode === OP_MODE.ERROR
          ? WIDGET_COLORS.DANGER
          : hasVehicle(mode)
            ? WIDGET_COLORS.INFO
            : WIDGET_COLORS.NEUTRAL;
    const components = [
      {
        type: 'value',
        label: text(TEXT.power),
        device_feature: ids.feature(CHARGER_FEATURE.POWER),
        icon: 'zap',
      },
      {
        type: 'value',
        label: text(TEXT.session),
        device_feature: ids.feature(CHARGER_FEATURE.SESSION_ENERGY),
        icon: 'battery-charging',
      },
      {
        type: 'value',
        label: text(TEXT.limit),
        device_feature: ids.feature(CHARGER_FEATURE.TARGET_CURRENT),
        icon: 'sliders',
      },
      {
        type: 'status',
        items: [
          { label: text(TEXT.status), value: text(STATUS[statusKey(state)]), color: statusColor },
          {
            label: text(TEXT.online),
            value: text(online ? TEXT.onlineYes : TEXT.onlineNo),
            color: online ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
          },
        ],
      },
    ];
    if (online && hasVehicle(mode)) {
      if (mode === OP_MODE.CHARGING) {
        components.push({
          type: 'button',
          label: text(TEXT.pause),
          icon: 'pause',
          action: { key: 'pause' },
        });
      } else {
        const paused = mode === OP_MODE.AWAITING_START;
        components.push({
          type: 'button',
          label: text(paused ? TEXT.resume : TEXT.start),
          icon: 'play',
          action: { key: 'start' },
        });
      }
      components.push({
        type: 'button',
        label: text(TEXT.stop),
        icon: 'square',
        style: 'danger',
        action: { key: 'stop', confirm: true },
      });
    }
    return { ttl_seconds: 60, components };
  }

  // --- Registration ------------------------------------------------------------

  async function apply(newConfig) {
    const next = normalizeConfig(newConfig);
    if (credentialsOf(next) !== credentialsOf(config)) {
      client = null;
      authRefused = false;
      pausedUntil = 0;
      readings.clear();
      lastMode.clear();
      highestIndex.clear();
    }
    config = next;
  }

  async function restart() {
    stopped = false;
    lastPolledAt.clear();
    if (await setup()) {
      await cycle({ force: true });
    }
    schedule();
  }

  function register() {
    gladys.onScanRequest(async () => {
      logger.debug('onScanRequest');
      if (await setup()) {
        await cycle();
      }
    });
    gladys.onSetValue(onSetValue);
    gladys.onPoll(async (device) => {
      const ref = parseExternalId(gladys, device.external_id);
      if (!ref || !(await ready())) {
        return;
      }
      // Fallback only: skipped while the container's timer keeps up.
      await pollDevice(device, ref, { minGap: 0.9 }).catch(() => {});
    });
    const pollNow = async (device) => {
      const ref = parseExternalId(gladys, device.external_id);
      if (!ref || !(await ready())) {
        return;
      }
      // The SDK forgot what it had published for this device: everything
      // is sent again now (the states sent before the device existed were
      // dropped by the core).
      await pollDevice(device, ref, { force: true }).catch(() => {});
      gladys.requestWidgetRefresh(WIDGET_KEY);
    };
    gladys.onDeviceCreated(pollNow);
    gladys.onDeviceUpdated(pollNow);

    gladys.onAction('test_connection', async () => {
      if (!isConfigured(config)) {
        throw new Error(thrown(TEXT.notConfiguredShort));
      }
      authRefused = false;
      pausedUntil = 0;
      client = null;
      lastAccountError = null;
      if (!(await setup())) {
        throw translateError(lastAccountError ?? new Error(thrown(TEXT.initFailed)));
      }
      logger.info('Connection test passed');
      return MESSAGES.connected(products.chargers.size, products.equalizers.size);
    });

    gladys.onSceneAction(SCENE_ACTION_KEY, async (fields) => {
      const id = chargerIdOf(fields.device);
      const sent = await chargerCommand(id, String(fields.command));
      return { command: sent };
    });

    gladys.onWidgetGet(WIDGET_KEY, async (request) => widgetContent(request));
    gladys.onWidgetAction(WIDGET_KEY, async (actionKey, _params, { settings } = {}) => {
      const id = chargerIdOf(settings?.device);
      const sent = await chargerCommand(id, actionKey);
      return MESSAGES.commandSent(sent, chargerName(id));
    });

    gladys.onConfigUpdated(async (newConfig) => {
      logger.info('Configuration updated');
      await apply(newConfig);
      await restart();
    });

    gladys.on('connected', async () => {
      try {
        await apply(await gladys.getConfig());
        await restart();
      } catch (err) {
        logger.error(`Initialization failed (${err.message})`);
        await gladys.setConnectionStatus(false, TEXT.initFailed).catch(() => {});
      }
    });
  }

  return {
    register,
    cycle,
    restart,
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
    },
    /** For the tests: what the timer would do at its next tick. */
    get config() {
      return config;
    },
  };
}

const iso = (ms) => new Date(ms).toISOString();
