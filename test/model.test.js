// -----------------------------------------------------------------------------
// Translation of the Easee answers into Gladys values (src/easee/model.js).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARGING_STATE as S,
  CONNECTOR_STATUS as CS,
  OP_MODE,
  chargeOn,
  chargingState,
  connectorStatus,
  equalizerReadings,
  phaseCurrents,
  powerW,
  productName,
  statusKey,
  transitions,
} from '../src/easee/model.js';
import { fixture } from './helpers/fakeEasee.js';

const mode = (chargerOpMode, extra = {}) => ({ chargerOpMode, isOnline: true, ...extra });

test('every operating mode maps onto the connector status and charging state of Gladys', () => {
  const expected = [
    // mode, connector, charging state, status text, charge switch
    [OP_MODE.OFFLINE, CS.UNAVAILABLE, S.IDLE, 'offline', 0],
    [OP_MODE.DISCONNECTED, CS.AVAILABLE, S.IDLE, 'disconnected', 0],
    [OP_MODE.AWAITING_START, CS.OCCUPIED, S.PAUSED_BY_CHARGER, 'awaitingStart', 0],
    [OP_MODE.CHARGING, CS.OCCUPIED, S.CHARGING, 'charging', 1],
    [OP_MODE.COMPLETED, CS.OCCUPIED, S.IDLE, 'completed', 0],
    [OP_MODE.ERROR, CS.FAULTED, S.IDLE, 'error', 0],
    [OP_MODE.READY_TO_CHARGE, CS.OCCUPIED, S.EV_CONNECTED, 'readyToCharge', 1],
    [OP_MODE.AWAITING_AUTHORIZATION, CS.OCCUPIED, S.EV_CONNECTED, 'awaitingAuthorization', 0],
    [OP_MODE.DEAUTHENTICATING, CS.OCCUPIED, S.IDLE, 'deauthenticating', 0],
  ];
  for (const [m, connector, charging, status, on] of expected) {
    const state = mode(m);
    assert.equal(connectorStatus(state), connector, `connector of mode ${m}`);
    assert.equal(chargingState(state), charging, `charging state of mode ${m}`);
    assert.equal(statusKey(state), status, `status of mode ${m}`);
    assert.equal(chargeOn(state), on, `charge switch of mode ${m}`);
  }
});

test('a vehicle that takes no current pauses on its side, a schedule or a pause on the charger', () => {
  assert.equal(chargingState(mode(2, { reasonForNoCurrent: 79 })), S.PAUSED_BY_VEHICLE);
  assert.equal(chargingState(mode(2, { reasonForNoCurrent: 81 })), S.PAUSED_BY_VEHICLE);
  assert.equal(chargingState(mode(2, { reasonForNoCurrent: 52 })), S.PAUSED_BY_CHARGER);
  assert.equal(chargingState(mode(2, { reasonForNoCurrent: 76 })), S.PAUSED_BY_CHARGER);
});

test('an offline charger is unavailable whatever its last mode', () => {
  const state = fixture('charger-state-offline');
  assert.equal(connectorStatus(state), CS.UNAVAILABLE);
  assert.equal(statusKey(mode(3, { isOnline: false })), 'offline');
  assert.equal(connectorStatus(mode(3, { isOnline: false })), CS.UNAVAILABLE);
});

test('an unknown or missing mode publishes nothing rather than a wrong value', () => {
  assert.equal(connectorStatus(mode(42)), null);
  assert.equal(statusKey(mode(42)), 'unknown');
  assert.equal(chargingState({}), null);
  assert.equal(chargeOn({}), null);
});

test('units: kW to W, phases from the T3 to T5 terminals', () => {
  const state = fixture('charger-state-charging');
  assert.equal(powerW(state), 10912);
  assert.deepEqual(phaseCurrents(state), [15.8, 15.9, 15.8]);
  assert.equal(powerW({ totalPower: -0.001 }), 0);
  assert.equal(powerW({}), null);
  assert.deepEqual(phaseCurrents({}), [null, null, null]);
});

test('the Equalizer gives import and export power, currents and meters', () => {
  assert.deepEqual(equalizerReadings(fixture('equalizer-state')), {
    importPower: 13730,
    exportPower: 0,
    currents: [21.4, 18.9, 20.2],
    importIndex: 18233.917,
    exportIndex: 1204.552,
  });
  assert.deepEqual(equalizerReadings({}).currents, [null, null, null]);
});

test('product names', () => {
  assert.equal(productName(1), 'Easee Home');
  assert.equal(productName(100), 'Easee Charge');
  assert.equal(productName(2), 'Easee Charge Lite');
  assert.equal(productName(999), 'Easee');
});

test('scene events only on real transitions', () => {
  assert.deepEqual(transitions(undefined, 3), [], 'first reading');
  assert.deepEqual(transitions(1, 2), ['vehicle_connected']);
  assert.deepEqual(transitions(1, 4), ['vehicle_connected']);
  assert.deepEqual(transitions(0, 3), [], 'back from offline');
  assert.deepEqual(transitions(3, 4), ['charging_completed']);
  assert.deepEqual(transitions(3, 1), [], 'unplugged while charging is not a completed charge');
  assert.deepEqual(transitions(2, 3), []);
  assert.deepEqual(transitions(4, 4), []);
});
