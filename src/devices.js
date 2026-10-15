// -----------------------------------------------------------------------------
// The Gladys devices: one per Easee charger, one per Equalizer.
//
// External ids are built from the serial number Easee gives each product
// (`EH123456`, `QP123456`...): they never change, whatever the name. Feature
// keys are frozen too. Feature names are frozen when the user adds the device,
// in the language of the configuration.
//
// Polling fields: `should_poll: true` with the one-minute frequency of the
// core list, so a core that polls calls onPoll (fallback); the container's own
// timer does the real work (src/poller.js, Gladys#3198).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { NAMES, STATUS, pick } from './i18n.js';
import {
  chargeOn,
  chargingState,
  connectorStatus,
  dynamicCurrent,
  enabledOf,
  equalizerReadings,
  lifetimeEnergyKwh,
  phaseCurrents,
  powerW,
  productName,
  sessionEnergyKwh,
  statusKey,
} from './easee/model.js';

export const DEVICE_TYPE = { CHARGER: 'charger', EQUALIZER: 'equalizer' };

/** Feature keys of a charger (frozen: they are part of the external ids). */
export const CHARGER_FEATURE = {
  CONNECTOR: 'connector',
  CHARGING_STATE: 'charging_state',
  STATUS: 'status',
  POWER: 'power',
  CURRENT_L1: 'current_l1',
  CURRENT_L2: 'current_l2',
  CURRENT_L3: 'current_l3',
  SESSION_ENERGY: 'session_energy',
  LIFETIME_ENERGY: 'lifetime_energy',
  TARGET_CURRENT: 'target_current',
  CHARGE: 'charge',
  ENABLED: 'enabled',
};

/** Feature keys of an Equalizer. */
export const EQUALIZER_FEATURE = {
  IMPORT_POWER: 'import_power',
  EXPORT_POWER: 'export_power',
  CURRENT_L1: 'current_l1',
  CURRENT_L2: 'current_l2',
  CURRENT_L3: 'current_l3',
  IMPORT_INDEX: 'import_index',
  EXPORT_INDEX: 'export_index',
};

const POLLING = { should_poll: true, poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES };

// Display bounds: the core never applies min/max on a state, they only scale
// the charts and gauges.
const MAX_POWER_W = 25000;
const MAX_CURRENT_A = 80;
const MAX_INDEX_KWH = 100000000;

function feature(ids, names, key, spec) {
  return {
    name: names[key],
    external_id: ids.feature(key),
    read_only: true,
    has_feedback: false,
    keep_history: true,
    ...spec,
  };
}

/**
 * @param {object} gladys GladysIntegration (externalIds)
 * @param {{ id: string, name?: string, productCode?: number }} charger as GET /api/chargers lists it
 * @param {{ language: string, maxCurrent?: number }} options
 */
export function buildChargerDevice(gladys, charger, { language, maxCurrent = 32 }) {
  const ids = gladys.externalIds(DEVICE_TYPE.CHARGER, charger.id);
  const names = NAMES[language] ?? NAMES.en;
  const f = (key, spec) => feature(ids, names, key, spec);
  const current = (key) =>
    f(key, {
      category: CAT.ENERGY_SENSOR,
      type: TYPE.ENERGY_SENSOR.CURRENT,
      unit: UNIT.AMPERE,
      min: 0,
      max: MAX_CURRENT_A,
    });
  return {
    name: charger.name?.trim() || charger.id,
    external_id: ids.device,
    model: productName(charger.productCode),
    ...POLLING,
    params: [{ name: 'EASEE_ID', value: String(charger.id) }],
    features: [
      f(CHARGER_FEATURE.CONNECTOR, {
        category: CAT.CHARGING_STATION,
        type: TYPE.CHARGING_STATION.CONNECTOR_STATUS,
        min: 0,
        max: 4,
      }),
      f(CHARGER_FEATURE.CHARGING_STATE, {
        category: CAT.CHARGING_STATION,
        type: TYPE.CHARGING_STATION.CHARGING_STATE,
        min: 0,
        max: 5,
      }),
      // text/text: min/max are NOT NULL in the core table, 0/0 like Zigbee2MQTT.
      f(CHARGER_FEATURE.STATUS, {
        category: CAT.TEXT,
        type: TYPE.TEXT.TEXT,
        min: 0,
        max: 0,
        keep_history: false,
      }),
      f(CHARGER_FEATURE.POWER, {
        category: CAT.ENERGY_SENSOR,
        type: TYPE.ENERGY_SENSOR.POWER,
        unit: UNIT.WATT,
        min: 0,
        max: MAX_POWER_W,
      }),
      current(CHARGER_FEATURE.CURRENT_L1),
      current(CHARGER_FEATURE.CURRENT_L2),
      current(CHARGER_FEATURE.CURRENT_L3),
      // Not energy-sensor/energy: the core reads that type as a meter index
      // for the energy monitoring, and a session restarts from zero.
      f(CHARGER_FEATURE.SESSION_ENERGY, {
        category: CAT.ELECTRICAL_VEHICLE_CHARGE,
        type: TYPE.ELECTRICAL_VEHICLE_CHARGE.LAST_CHARGE_ENERGY_ADDED,
        unit: UNIT.KILOWATT_HOUR,
        min: 0,
        max: 200,
      }),
      // The meter index of the 5.2 energy monitoring (consumption every 30 min).
      f(CHARGER_FEATURE.LIFETIME_ENERGY, {
        category: CAT.ENERGY_SENSOR,
        type: TYPE.ENERGY_SENSOR.INDEX,
        unit: UNIT.KILOWATT_HOUR,
        min: 0,
        max: MAX_INDEX_KWH,
      }),
      f(CHARGER_FEATURE.TARGET_CURRENT, {
        category: CAT.ELECTRICAL_VEHICLE_CHARGE,
        type: TYPE.ELECTRICAL_VEHICLE_CHARGE.TARGET_CURRENT,
        unit: UNIT.AMPERE,
        min: 0,
        max: maxCurrent,
        step: 1,
        read_only: false,
        has_feedback: true,
      }),
      f(CHARGER_FEATURE.CHARGE, {
        category: CAT.ELECTRICAL_VEHICLE_CHARGE,
        type: TYPE.ELECTRICAL_VEHICLE_CHARGE.CHARGE_ON,
        min: 0,
        max: 1,
        read_only: false,
        has_feedback: true,
      }),
      f(CHARGER_FEATURE.ENABLED, {
        category: CAT.SWITCH,
        type: TYPE.SWITCH.BINARY,
        min: 0,
        max: 1,
        read_only: false,
        has_feedback: true,
      }),
    ],
  };
}

/**
 * @param {object} gladys
 * @param {{ id: string, name?: string }} equalizer as GET /api/accounts/products lists it
 * @param {{ language: string }} options
 */
export function buildEqualizerDevice(gladys, equalizer, { language }) {
  const ids = gladys.externalIds(DEVICE_TYPE.EQUALIZER, equalizer.id);
  const names = NAMES[language] ?? NAMES.en;
  const f = (key, spec) => feature(ids, names, key, spec);
  const power = (key, type) =>
    f(key, { category: CAT.GRID_SENSOR, type, unit: UNIT.WATT, min: 0, max: 100000 });
  const index = (key, type) =>
    f(key, {
      category: CAT.GRID_SENSOR,
      type,
      unit: UNIT.KILOWATT_HOUR,
      min: 0,
      max: MAX_INDEX_KWH,
    });
  const current = (key) =>
    f(key, {
      category: CAT.ENERGY_SENSOR,
      type: TYPE.ENERGY_SENSOR.CURRENT,
      unit: UNIT.AMPERE,
      min: 0,
      max: 100,
    });
  return {
    name: equalizer.name?.trim() || `Equalizer ${equalizer.id}`,
    external_id: ids.device,
    model: 'Easee Equalizer',
    ...POLLING,
    params: [{ name: 'EASEE_ID', value: String(equalizer.id) }],
    features: [
      power(EQUALIZER_FEATURE.IMPORT_POWER, TYPE.GRID_SENSOR.INPUT_POWER),
      power(EQUALIZER_FEATURE.EXPORT_POWER, TYPE.GRID_SENSOR.OUTPUT_POWER),
      current(EQUALIZER_FEATURE.CURRENT_L1),
      current(EQUALIZER_FEATURE.CURRENT_L2),
      current(EQUALIZER_FEATURE.CURRENT_L3),
      index(EQUALIZER_FEATURE.IMPORT_INDEX, TYPE.GRID_SENSOR.INPUT_INDEX),
      index(EQUALIZER_FEATURE.EXPORT_INDEX, TYPE.GRID_SENSOR.OUTPUT_INDEX),
    ],
  };
}

const numeric = (id, value) =>
  value === null || value === undefined ? null : { device_feature_external_id: id, state: value };

/**
 * The states of a charger reading, in the publishStates format.
 * @param {{ feature: (key: string) => string }} ids
 * @param {object} state GET /api/chargers/{id}/state
 * @param {object|null} config GET /api/chargers/{id}/config (may be unknown)
 * @param {string} language
 */
export function chargerStates(ids, state, config, language) {
  const [l1, l2, l3] = phaseCurrents(state);
  const F = CHARGER_FEATURE;
  return [
    numeric(ids.feature(F.CONNECTOR), connectorStatus(state)),
    numeric(ids.feature(F.CHARGING_STATE), chargingState(state)),
    {
      device_feature_external_id: ids.feature(F.STATUS),
      text: pick(STATUS[statusKey(state)], language),
    },
    numeric(ids.feature(F.POWER), powerW(state)),
    numeric(ids.feature(F.CURRENT_L1), l1),
    numeric(ids.feature(F.CURRENT_L2), l2),
    numeric(ids.feature(F.CURRENT_L3), l3),
    numeric(ids.feature(F.SESSION_ENERGY), sessionEnergyKwh(state)),
    numeric(ids.feature(F.LIFETIME_ENERGY), lifetimeEnergyKwh(state)),
    numeric(ids.feature(F.TARGET_CURRENT), dynamicCurrent(state)),
    numeric(ids.feature(F.CHARGE), chargeOn(state)),
    numeric(ids.feature(F.ENABLED), enabledOf(config)),
  ].filter(Boolean);
}

/** The states of an Equalizer reading. */
export function equalizerStates(ids, state) {
  const r = equalizerReadings(state);
  const F = EQUALIZER_FEATURE;
  return [
    numeric(ids.feature(F.IMPORT_POWER), r.importPower),
    numeric(ids.feature(F.EXPORT_POWER), r.exportPower),
    numeric(ids.feature(F.CURRENT_L1), r.currents[0]),
    numeric(ids.feature(F.CURRENT_L2), r.currents[1]),
    numeric(ids.feature(F.CURRENT_L3), r.currents[2]),
    numeric(ids.feature(F.IMPORT_INDEX), r.importIndex),
    numeric(ids.feature(F.EXPORT_INDEX), r.exportIndex),
  ].filter(Boolean);
}

/**
 * Which device an external id names: { type, id } or null.
 * @param {object} gladys
 * @param {string} externalId a device or feature external id
 */
export function parseExternalId(gladys, externalId) {
  const prefix = gladys.externalId('');
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const [type, id] = externalId.slice(prefix.length).split(':');
  if (!Object.values(DEVICE_TYPE).includes(type) || !id) {
    return null;
  }
  return { type, id };
}
