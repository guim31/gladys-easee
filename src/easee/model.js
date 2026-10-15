// -----------------------------------------------------------------------------
// Pure translation of what the Easee API answers into what Gladys shows.
//
// The charger reports one operating mode (`chargerOpMode`). Gladys 5.2 has a
// generic charging-station vocabulary aligned on OCPP 2.0.1: a connector
// status (available, occupied, unavailable, faulted) and, while a vehicle is
// there, a charging state (charging, vehicle connected, paused by the vehicle
// or by the charger, idle). The core comments (server/utils/constants.js) give
// the split of an OCPP 1.6 status across both; the Easee modes follow it.
// -----------------------------------------------------------------------------

/** chargerOpMode values (Easee API, same in pyeasee and evcc). */
export const OP_MODE = {
  OFFLINE: 0,
  DISCONNECTED: 1,
  AWAITING_START: 2,
  CHARGING: 3,
  COMPLETED: 4,
  ERROR: 5,
  READY_TO_CHARGE: 6,
  AWAITING_AUTHORIZATION: 7,
  DEAUTHENTICATING: 8,
};

/** CHARGING_STATION_CONNECTOR_STATUS of the Gladys core. */
export const CONNECTOR_STATUS = {
  AVAILABLE: 0,
  OCCUPIED: 1,
  RESERVED: 2,
  UNAVAILABLE: 3,
  FAULTED: 4,
};

/** CHARGING_STATION_CHARGING_STATE of the Gladys core. */
export const CHARGING_STATE = {
  CHARGING: 0,
  EV_CONNECTED: 1,
  PAUSED_BY_VEHICLE: 2,
  PAUSED_BY_CHARGER: 3,
  IDLE: 4,
  DISCHARGING: 5,
};

/** Modes in which a vehicle is plugged in. */
const VEHICLE_MODES = new Set([
  OP_MODE.AWAITING_START,
  OP_MODE.CHARGING,
  OP_MODE.COMPLETED,
  OP_MODE.READY_TO_CHARGE,
  OP_MODE.AWAITING_AUTHORIZATION,
  OP_MODE.DEAUTHENTICATING,
]);

// reasonForNoCurrent values meaning the vehicle itself takes no current
// (79 "EV is not charging", 81 "Limited by EV"): the rest of the waiting
// reasons come from the charger side (schedule, pause, load balancing...).
const VEHICLE_REASONS = new Set([79, 81]);

/** Key of the status text (src/i18n.js STATUS) of an operating mode. */
const STATUS_KEYS = {
  [OP_MODE.OFFLINE]: 'offline',
  [OP_MODE.DISCONNECTED]: 'disconnected',
  [OP_MODE.AWAITING_START]: 'awaitingStart',
  [OP_MODE.CHARGING]: 'charging',
  [OP_MODE.COMPLETED]: 'completed',
  [OP_MODE.ERROR]: 'error',
  [OP_MODE.READY_TO_CHARGE]: 'readyToCharge',
  [OP_MODE.AWAITING_AUTHORIZATION]: 'awaitingAuthorization',
  [OP_MODE.DEAUTHENTICATING]: 'deauthenticating',
};

/** Product names by productCode (as the Easee app names them). */
const PRODUCTS = {
  1: 'Easee Home',
  2: 'Easee Charge Lite',
  3: 'Easee Charge Max',
  4: 'Easee Charge Up',
  100: 'Easee Charge',
  102: 'Easee Charge Core',
  103: 'Easee Charge Pro',
  400: 'Easee One',
};

export function productName(productCode) {
  return PRODUCTS[productCode] ?? 'Easee';
}

const finite = (value) => {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
};

const round = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** The operating mode of a charger state, or null when absent. */
export function opModeOf(state) {
  const mode = finite(state?.chargerOpMode);
  return mode === null ? null : Math.trunc(mode);
}

/** The charger reaches the cloud (an absent flag counts as online). */
export function isOnline(state) {
  return state?.isOnline !== false && opModeOf(state) !== OP_MODE.OFFLINE;
}

export function hasVehicle(mode) {
  return VEHICLE_MODES.has(mode);
}

/** @returns {number|null} a CONNECTOR_STATUS value */
export function connectorStatus(state) {
  const mode = opModeOf(state);
  if (!isOnline(state)) {
    return CONNECTOR_STATUS.UNAVAILABLE;
  }
  if (mode === OP_MODE.DISCONNECTED) {
    return CONNECTOR_STATUS.AVAILABLE;
  }
  if (mode === OP_MODE.ERROR) {
    return CONNECTOR_STATUS.FAULTED;
  }
  return VEHICLE_MODES.has(mode) ? CONNECTOR_STATUS.OCCUPIED : null;
}

/**
 * The charging state. The core only gives it a meaning during a session; the
 * rest of the time it is published as idle, so a charge interrupted by an
 * unplugged cable does not stay "charging" on the dashboard.
 * @returns {number|null} a CHARGING_STATE value
 */
export function chargingState(state) {
  const mode = opModeOf(state);
  switch (mode) {
    case OP_MODE.CHARGING:
      return CHARGING_STATE.CHARGING;
    case OP_MODE.AWAITING_START:
      return VEHICLE_REASONS.has(finite(state.reasonForNoCurrent))
        ? CHARGING_STATE.PAUSED_BY_VEHICLE
        : CHARGING_STATE.PAUSED_BY_CHARGER;
    case OP_MODE.READY_TO_CHARGE:
    case OP_MODE.AWAITING_AUTHORIZATION:
      return CHARGING_STATE.EV_CONNECTED;
    case null:
      return null;
    default:
      return CHARGING_STATE.IDLE;
  }
}

/** Key of the status text: one of STATUS in src/i18n.js. */
export function statusKey(state) {
  if (state?.isOnline === false) {
    return 'offline';
  }
  return STATUS_KEYS[opModeOf(state)] ?? 'unknown';
}

/** 1 while the charger delivers or is about to (the "charge" switch). */
export function chargeOn(state) {
  const mode = opModeOf(state);
  if (mode === null) {
    return null;
  }
  return mode === OP_MODE.CHARGING || mode === OP_MODE.READY_TO_CHARGE ? 1 : 0;
}

/** Total power, in watts (the API gives kilowatts). */
export function powerW(state) {
  const kw = finite(state?.totalPower);
  return kw === null ? null : Math.max(0, Math.round(kw * 1000));
}

/** Energy of the session in progress (or of the last one), in kWh. */
export function sessionEnergyKwh(state) {
  const kwh = finite(state?.sessionEnergy);
  return kwh === null ? null : Math.max(0, round(kwh, 3));
}

/** Energy meter of the charger since its installation, in kWh. */
export function lifetimeEnergyKwh(state) {
  const kwh = finite(state?.lifetimeEnergy);
  return kwh === null || kwh < 0 ? null : round(kwh, 3);
}

/**
 * Current per phase, in amperes. On the TN grids of most of Europe the
 * terminals T3, T4 and T5 carry L1, L2 and L3 (T2 is the neutral); on an IT
 * grid (Norway) the phases sit on other terminals, see docs.
 */
export function phaseCurrents(state) {
  return ['inCurrentT3', 'inCurrentT4', 'inCurrentT5'].map((key) => {
    const amps = finite(state?.[key]);
    return amps === null ? null : Math.max(0, round(amps, 1));
  });
}

/** The current the charger may deliver right now (dynamic limit), in amperes. */
export function dynamicCurrent(state) {
  const amps = finite(state?.dynamicChargerCurrent);
  return amps === null ? null : Math.max(0, Math.round(amps));
}

/** Highest current the charger accepts (its config), 32 A when unknown. */
export function maxChargerCurrent(config) {
  const amps = finite(config?.maxChargerCurrent);
  return amps === null || amps <= 0 ? 32 : Math.round(amps);
}

/** Charger enabled in its settings (1/0), null when unknown. */
export function enabledOf(config) {
  if (typeof config?.isEnabled !== 'boolean') {
    return null;
  }
  return config.isEnabled ? 1 : 0;
}

/**
 * What a reading of the Equalizer (the house meter) gives: import and export
 * power in W, the current of each phase in A, the import and export meters in
 * kWh.
 */
export function equalizerReadings(state) {
  const kw = (key) => {
    const value = finite(state?.[key]);
    return value === null ? null : Math.max(0, Math.round(value * 1000));
  };
  const kwh = (key) => {
    const value = finite(state?.[key]);
    return value === null || value < 0 ? null : round(value, 3);
  };
  return {
    importPower: kw('activePowerImport'),
    exportPower: kw('activePowerExport'),
    currents: ['currentL1', 'currentL2', 'currentL3'].map((key) => {
      const amps = finite(state?.[key]);
      return amps === null ? null : Math.max(0, round(amps, 1));
    }),
    importIndex: kwh('cumulativeActivePowerImport'),
    exportIndex: kwh('cumulativeActivePowerExport'),
  };
}

/**
 * The scene events a change of operating mode means, or [].
 *   - vehicle_connected: from "no vehicle" to any mode with a vehicle (never
 *     from offline: a charger coming back with a vehicle already there is not
 *     a vehicle being plugged in);
 *   - charging_completed: from charging to completed (the vehicle stopped
 *     taking current by itself — a full battery or its own limit).
 * @param {number|null|undefined} previous
 * @param {number|null} current
 * @returns {string[]}
 */
export function transitions(previous, current) {
  if (previous === null || previous === undefined || current === null || previous === current) {
    return [];
  }
  const events = [];
  if (previous === OP_MODE.DISCONNECTED && VEHICLE_MODES.has(current)) {
    events.push('vehicle_connected');
  }
  if (previous === OP_MODE.CHARGING && current === OP_MODE.COMPLETED) {
    events.push('charging_completed');
  }
  return events;
}
