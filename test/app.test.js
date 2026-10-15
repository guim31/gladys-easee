// -----------------------------------------------------------------------------
// The integration end to end: the SDK's fake Gladys on one side, the fake
// Easee cloud on the other (test/helpers), the app between them as index.js
// wires it.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { HEARTBEAT_MS, WIDGET_KEY } from '../src/app.js';
import { CHARGING_STATE, CONNECTOR_STATUS } from '../src/easee/model.js';
import { ACCOUNT, fixture } from './helpers/fakeEasee.js';
import { createWorld } from './helpers/world.js';

const MINUTE = 60 * 1000;
const C = 'charger';
const EQ = 'equalizer';

function feature(world, type, id, key) {
  const device = world.device(type, id);
  return device.features.find(
    (f) => f.external_id === world.gladys.externalIds(type, id).feature(key),
  );
}

test('publishes a device per charger and per Equalizer, then their states once added', async () => {
  const world = await createWorld();
  const names = world.gladys.fake.discoveredDevices.map((d) => `${d.name} (${d.model})`);
  assert.deepEqual(names, [
    'Garage (Easee Home)',
    'Allée (Easee Charge)',
    'Equalizer (Easee Equalizer)',
  ]);
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });

  assert.equal(world.state(C, 'EH000001', 'connector'), CONNECTOR_STATUS.OCCUPIED);
  assert.equal(world.state(C, 'EH000001', 'charging_state'), CHARGING_STATE.CHARGING);
  assert.equal(world.state(C, 'EH000001', 'status'), 'En charge');
  assert.equal(world.state(C, 'EH000001', 'power'), 10912);
  assert.equal(world.state(C, 'EH000001', 'current_l1'), 15.8);
  assert.equal(world.state(C, 'EH000001', 'session_energy'), 7.421);
  assert.equal(world.state(C, 'EH000001', 'lifetime_energy'), 4821.337);
  assert.equal(world.state(C, 'EH000001', 'target_current'), 16);
  assert.equal(world.state(C, 'EH000001', 'charge'), 1);
  assert.equal(world.state(C, 'EH000001', 'enabled'), 1);

  assert.equal(world.state(C, 'EC000002', 'connector'), CONNECTOR_STATUS.AVAILABLE);
  assert.equal(world.state(C, 'EC000002', 'charging_state'), CHARGING_STATE.IDLE);
  assert.equal(world.state(C, 'EC000002', 'status'), 'Aucun véhicule');

  assert.equal(world.state(EQ, 'QP000003', 'import_power'), 13730);
  assert.equal(world.state(EQ, 'QP000003', 'export_power'), 0);
  assert.equal(world.state(EQ, 'QP000003', 'current_l2'), 18.9);
  assert.equal(world.state(EQ, 'QP000003', 'import_index'), 18233.917);
  assert.equal(world.state(EQ, 'QP000003', 'export_index'), 1204.552);

  // The current limit goes up to the maximum of each charger.
  assert.equal(feature(world, C, 'EH000001', 'target_current').max, 32);
  assert.equal(feature(world, C, 'EC000002', 'target_current').max, 16);
  assert.deepEqual(
    world.gladys.fake.transports.map((t) => t.transport),
    ['cloud', 'cloud', 'cloud'],
  );
});

test('the feature names follow the configured language', async () => {
  const world = await createWorld({ config: { language: 'de' } });
  assert.equal(feature(world, C, 'EH000001', 'session_energy').name, 'Energie der Ladung');
  assert.equal(world.state(C, 'EH000001', 'status'), 'Lädt');
});

test('nothing is read for a device the user did not add', async () => {
  const world = await createWorld({ created: false });
  assert.equal(world.gladys.fake.discoveredDevices.length, 3);
  assert.equal(world.gladys.fake.states.length, 0);
  assert.ok(!world.easee.paths().some((p) => p.endsWith('/state')));
});

test('the states refresh on the container timer, without any onPoll from the core', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-14T18:43:00Z') });
  const world = await createWorld({ timers: true });
  const polls = world.gladys.fake.wsMessages.filter((m) => m.type === 'poll');
  world.easee.states.EH000001 = { ...world.easee.states.EH000001, totalPower: 7.2 };

  world.advance(MINUTE);
  t.mock.timers.tick(MINUTE);
  // Let the cycle of the timer run its requests.
  for (let i = 0; i < 50 && world.state(C, 'EH000001', 'power') !== 7200; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(world.state(C, 'EH000001', 'power'), 7200);
  assert.equal(polls.length, 0, 'the core never asked');
  world.app.stop();
});

test('only the changes are published, and an unchanged value again after the heartbeat', async () => {
  const world = await createWorld();
  const count = () => world.gladys.fake.states.length;
  const before = count();

  world.advance(MINUTE);
  await world.app.cycle();
  assert.equal(count(), before, 'nothing changed, nothing sent');

  world.easee.states.EH000001 = { ...world.easee.states.EH000001, totalPower: 11.04 };
  world.advance(MINUTE);
  await world.app.cycle();
  assert.equal(count(), before + 1);
  assert.equal(world.state(C, 'EH000001', 'power'), 11040);

  // The heartbeat of the SDK uses the real clock: six hours later, everything again.
  const realNow = Date.now;
  Date.now = () => realNow() + HEARTBEAT_MS + MINUTE;
  try {
    world.advance(MINUTE);
    await world.app.cycle();
  } finally {
    Date.now = realNow;
  }
  assert.ok(count() >= before + 1 + 25, 'every value re-sent after the heartbeat');
  assert.ok(HEARTBEAT_MS <= 12 * 60 * MINUTE);
});

test('a device the user adds gets all its states again, and the widget is refreshed', async () => {
  const world = await createWorld();
  const device = world.device(C, 'EH000001');
  const before = world.gladys.fake.states.length;
  await world.gladys.fake.deviceCreated(device);
  const sent = world.gladys.fake.states.slice(before).map((s) => s.device_feature_external_id);
  assert.equal(sent.length, 12, 'every feature of the charger');
  assert.ok(world.gladys.fake.widgetRefreshes.includes(WIDGET_KEY));
});

test('the core poll is only a fallback: skipped while the timer keeps up', async () => {
  const world = await createWorld();
  const reads = () =>
    world.easee.paths().filter((p) => p === '/api/chargers/EH000001/state').length;
  const before = reads();
  assert.deepEqual(await world.gladys.fake.poll(world.device(C, 'EH000001')), { success: true });
  assert.equal(reads(), before);
  world.advance(MINUTE);
  await world.gladys.fake.poll(world.device(C, 'EH000001'));
  assert.equal(reads(), before + 1, 'the timer stalled: the core poll reads');
});

test('a normal cycle writes nothing at info level, and no secret ever reaches the logs', async () => {
  const world = await createWorld();
  for (let i = 0; i < 3; i += 1) {
    world.advance(MINUTE);
    world.easee.states.EH000001 = {
      ...world.easee.states.EH000001,
      totalPower: 10 + i,
      sessionEnergy: 8 + i,
    };
    await world.app.cycle();
  }
  assert.deepEqual(world.logger.at('info'), ['Connected to Easee: 2 charger(s), 1 Equalizer(s)']);
  assert.deepEqual(world.logger.at('warn'), []);

  // Errors of every kind, then a command: still no secret.
  world.easee.fail.push({ path: /state$/, status: 503 }, { network: true });
  world.advance(MINUTE);
  await world.app.cycle();
  world.advance(MINUTE);
  await world.app.cycle();
  await world.gladys.fake.setValue(
    world.device(C, 'EH000001'),
    feature(world, C, 'EH000001', 'target_current'),
    10,
  );
  const everything = world.logger.lines.map((l) => l.message).join('\n');
  for (const secret of [ACCOUNT.password, 'access-', 'refresh-', ACCOUNT.username]) {
    assert.ok(!everything.includes(secret), `"${secret}" leaked into the logs`);
  }
  const requestsWithSecret = world.gladys.fake.requests.filter((r) =>
    JSON.stringify(r.body ?? '').includes(ACCOUNT.password),
  );
  assert.deepEqual(requestsWithSecret, [], 'the password never goes to Gladys');
});

test('a cloud outage is said once, and its end once', async () => {
  const world = await createWorld();
  world.logger.clear();
  for (let i = 0; i < 3; i += 1) {
    world.easee.fail.push({ network: true });
    world.advance(MINUTE);
    await world.app.cycle();
  }
  assert.equal(world.logger.at('warn').length, 1);
  assert.match(world.logger.at('warn')[0], /Easee cloud unreachable/);
  assert.equal(world.gladys.fake.connectionStatus.connected, false);

  world.advance(MINUTE);
  await world.app.cycle();
  assert.deepEqual(world.logger.at('info'), ['Easee cloud reachable again']);
  assert.equal(world.gladys.fake.connectionStatus.connected, true);
});

test('a charger going offline shows unavailable and the cloud badge turns unreachable', async () => {
  const world = await createWorld();
  world.logger.clear();
  world.easee.states.EH000001 = fixture('charger-state-offline');
  world.advance(MINUTE);
  await world.app.cycle();
  assert.equal(world.state(C, 'EH000001', 'connector'), CONNECTOR_STATUS.UNAVAILABLE);
  assert.equal(world.state(C, 'EH000001', 'status'), 'Hors ligne');
  const last = world.gladys.fake.transports.at(-1);
  assert.equal(last.transport, 'unreachable');
  assert.deepEqual(world.logger.at('info'), ['Garage: offline']);

  world.easee.states.EH000001 = fixture('charger-state-charging');
  world.advance(MINUTE);
  await world.app.cycle();
  assert.equal(world.gladys.fake.transports.at(-1).transport, 'cloud');
  assert.deepEqual(world.logger.at('info'), ['Garage: offline', 'Garage: back online']);
});

test('refused credentials stop every request until the configuration changes', async () => {
  const world = await createWorld({ config: { password: 'wrong' }, created: false });
  assert.equal(world.gladys.fake.connectionStatus.connected, false);
  assert.match(world.gladys.fake.connectionStatus.message.fr, /refusé/);
  const requests = world.easee.requests.length;
  for (let i = 0; i < 5; i += 1) {
    world.advance(MINUTE);
    await world.app.cycle();
  }
  assert.equal(world.easee.requests.length, requests, 'no retry that could lock the account');
  assert.equal(world.logger.at('warn').length, 1);

  await world.gladys.fake.configUpdated({ ...ACCOUNT });
  assert.equal(world.gladys.fake.connectionStatus.connected, true);
  assert.equal(world.gladys.fake.discoveredDevices.length, 3);
});

test('without an account, the configuration screen says what to fill in', async () => {
  const world = await createWorld({ config: { username: '', password: '' }, created: false });
  assert.equal(world.gladys.fake.connectionStatus.connected, false);
  assert.match(world.gladys.fake.connectionStatus.message.en, /e-mail address/);
  assert.equal(world.easee.requests.length, 0);
});

test('a 429 pauses the readings for the delay Easee asks', async () => {
  const world = await createWorld();
  world.easee.fail.push({ path: /state$/, status: 429, headers: { 'retry-after': '120' } });
  world.advance(MINUTE);
  await world.app.cycle();
  const after429 = world.easee.requests.length;
  world.advance(MINUTE);
  await world.app.cycle();
  assert.equal(world.easee.requests.length, after429, 'paused');
  world.advance(MINUTE + 1000);
  await world.app.cycle();
  assert.ok(world.easee.requests.length > after429, 'resumed after Retry-After');
  assert.deepEqual(world.logger.at('warn').length, 1);
});

test('a meter index never goes back', async () => {
  const world = await createWorld();
  world.easee.states.EH000001 = { ...world.easee.states.EH000001, lifetimeEnergy: 12.5 };
  world.advance(MINUTE);
  await world.app.cycle();
  assert.equal(world.state(C, 'EH000001', 'lifetime_energy'), 4821.337);
  world.easee.states.EH000001 = { ...world.easee.states.EH000001, lifetimeEnergy: 4822.1 };
  world.advance(MINUTE);
  await world.app.cycle();
  assert.equal(world.state(C, 'EH000001', 'lifetime_energy'), 4822.1);
});

test('plugging a vehicle in and the end of a charge fire the scene triggers', async () => {
  const world = await createWorld();
  const id = world.gladys.externalIds(C, 'EC000002').device;

  world.easee.states.EC000002 = fixture('charger-state-paused');
  world.advance(MINUTE);
  await world.app.cycle();
  world.easee.states.EC000002 = fixture('charger-state-charging');
  world.advance(MINUTE);
  await world.app.cycle();
  world.easee.states.EC000002 = fixture('charger-state-completed');
  world.advance(MINUTE);
  await world.app.cycle();
  // Unplugged, then the charger goes offline and comes back: no event.
  world.easee.states.EC000002 = fixture('charger-state-disconnected');
  world.advance(MINUTE);
  await world.app.cycle();
  world.easee.states.EC000002 = fixture('charger-state-offline');
  world.advance(MINUTE);
  await world.app.cycle();
  world.easee.states.EC000002 = fixture('charger-state-charging');
  world.advance(MINUTE);
  await world.app.cycle();

  assert.deepEqual(world.gladys.fake.sceneEvents, [
    {
      key: 'vehicle_connected',
      data: { charger: id, charger_name: 'Allée', session_energy: 7.4213 },
    },
    {
      key: 'charging_completed',
      data: { charger: id, charger_name: 'Allée', session_energy: 38.5521 },
    },
  ]);
  // The first reading after a start is not a transition.
  assert.ok(world.gladys.fake.widgetRefreshes.length > 0);
});

test('the charge switch pauses and resumes, and the effect is read back', async () => {
  const world = await createWorld();
  const device = world.device(C, 'EH000001');
  world.logger.clear();

  const ack = await world.gladys.fake.setValue(device, feature(world, C, 'EH000001', 'charge'), 0);
  assert.deepEqual(ack, { success: true });
  assert.deepEqual(
    world.easee.paths('POST').at(-1),
    '/api/chargers/EH000001/commands/pause_charging',
  );
  await world.runLaters();
  assert.equal(world.state(C, 'EH000001', 'charge'), 0);
  assert.equal(world.state(C, 'EH000001', 'charging_state'), CHARGING_STATE.PAUSED_BY_CHARGER);

  await world.gladys.fake.setValue(device, feature(world, C, 'EH000001', 'charge'), 1);
  assert.deepEqual(
    world.easee.paths('POST').at(-1),
    '/api/chargers/EH000001/commands/resume_charging',
  );
  await world.runLaters();
  assert.equal(world.state(C, 'EH000001', 'charge'), 1);
  assert.deepEqual(world.logger.at('info'), ['Garage: pause_charging', 'Garage: resume_charging']);
});

test('start uses start_charging when the charger waits for an authorization', async () => {
  const world = await createWorld();
  world.easee.states.EH000001 = { ...world.easee.states.EH000001, chargerOpMode: 7 };
  world.advance(MINUTE);
  await world.app.cycle();
  await world.gladys.fake.setValue(
    world.device(C, 'EH000001'),
    feature(world, C, 'EH000001', 'charge'),
    1,
  );
  assert.equal(world.easee.paths('POST').at(-1), '/api/chargers/EH000001/commands/start_charging');
});

test('a command without a vehicle is refused with a readable message', async () => {
  const world = await createWorld();
  const ack = await world.gladys.fake.setValue(
    world.device(C, 'EC000002'),
    feature(world, C, 'EC000002', 'charge'),
    1,
  );
  assert.equal(ack.success, false);
  assert.match(ack.error, /No vehicle connected\. \/ Aucun véhicule branché\./);
  assert.ok(!world.easee.paths('POST').some((p) => p.includes('/commands/')));
});

test('the current limit is checked, sent as a dynamic setting and shown at once', async () => {
  const world = await createWorld();
  const device = world.device(C, 'EC000002');
  const limit = feature(world, C, 'EC000002', 'target_current');

  for (const wrong of [3, 20]) {
    const ack = await world.gladys.fake.setValue(device, limit, wrong);
    assert.equal(ack.success, false, `${wrong} A refused (16 A charger)`);
  }
  assert.deepEqual(await world.gladys.fake.setValue(device, limit, 10), { success: true });
  const settings = world.easee.requests.filter((r) => r.path.endsWith('/settings'));
  assert.deepEqual(
    settings.map((r) => r.body),
    [{ dynamicChargerCurrent: 10 }],
  );
  assert.equal(world.state(C, 'EC000002', 'target_current'), 10);
  assert.deepEqual(await world.gladys.fake.setValue(device, limit, 0), { success: true });
});

test('the charger can be disabled and enabled again', async () => {
  const world = await createWorld();
  const device = world.device(C, 'EH000001');
  const enabled = feature(world, C, 'EH000001', 'enabled');
  await world.gladys.fake.setValue(device, enabled, 0);
  assert.equal(world.state(C, 'EH000001', 'enabled'), 0);
  await world.runLaters();
  assert.equal(world.easee.configs.EH000001.isEnabled, false);
  assert.equal(world.state(C, 'EH000001', 'enabled'), 0, 'read back from the settings');
  await world.gladys.fake.setValue(device, enabled, 1);
  assert.equal(world.easee.configs.EH000001.isEnabled, true);
});

test('a refused command says why', async () => {
  const world = await createWorld();
  world.easee.fail.push({ path: /commands/, status: 400, body: { title: 'Bad state' } });
  const ack = await world.gladys.fake.setValue(
    world.device(C, 'EH000001'),
    feature(world, C, 'EH000001', 'charge'),
    0,
  );
  assert.equal(ack.success, false);
  assert.match(ack.error, /Easee refused the command\..*\(HTTP 400\)/);
});

test('the scene action starts, pauses or stops a charge', async () => {
  const world = await createWorld();
  const device = world.gladys.externalIds(C, 'EH000001').device;
  const ack = await world.gladys.fake.sceneAction('charger_command', { device, command: 'stop' });
  assert.deepEqual(ack, { success: true, data: { outputs: { command: 'stop_charging' } } });
  const wrong = await world.gladys.fake.sceneAction('charger_command', {
    device: world.gladys.externalIds(EQ, 'QP000003').device,
    command: 'pause',
  });
  assert.equal(wrong.success, false);
  assert.match(wrong.error, /Unknown charger/);
});

test('the connection test lists what the account holds', async () => {
  const world = await createWorld();
  const ack = await world.gladys.fake.action('test_connection');
  assert.equal(ack.success, true);
  assert.equal(ack.data.message.fr, 'Connecté à Easee : 2 borne(s), 1 Equalizer(s).');

  world.easee.fail.push({ network: true });
  const down = await world.gladys.fake.action('test_connection');
  assert.equal(down.success, false);
  assert.match(down.error, /Easee cloud unreachable\./);

  world.easee.password = 'changed in the Easee app';
  world.easee.validTokens.clear();
  const refused = await world.gladys.fake.action('test_connection');
  assert.equal(refused.success, false);
  assert.match(refused.error, /Easee refused the e-mail address/);
});

test('the widget shows a charger and its buttons, inside the core budget', async () => {
  const world = await createWorld();
  const device = world.gladys.externalIds(C, 'EH000001').device;
  const ack = await world.gladys.fake.widgetGet(WIDGET_KEY, {
    settings: { device },
    language: 'fr',
  });
  assert.equal(ack.success, true);
  const { content } = ack.data;
  assert.deepEqual(validateWidgetContent(content), []);
  const status = content.components.find((c) => c.type === 'status');
  assert.deepEqual(
    status.items.map((i) => i.value),
    ['En charge', 'En ligne'],
  );
  assert.deepEqual(
    content.components.filter((c) => c.type === 'button').map((c) => c.action.key),
    ['pause', 'stop'],
  );
  // Every tile is bound to a feature the device really has.
  const ids = new Set(world.device(C, 'EH000001').features.map((f) => f.external_id));
  for (const tile of content.components.filter((c) => c.device_feature)) {
    assert.ok(ids.has(tile.device_feature), tile.device_feature);
  }

  const toast = await world.gladys.fake.widgetAction(
    WIDGET_KEY,
    'pause',
    {},
    { settings: { device } },
  );
  assert.equal(toast.success, true);
  assert.equal(toast.data.message.fr, 'Commande « Pause » envoyée à Garage.');

  // No vehicle: no button. Not a charger, no device: a sentence.
  const free = await world.gladys.fake.widgetGet(WIDGET_KEY, {
    settings: { device: world.gladys.externalIds(C, 'EC000002').device },
    language: 'en',
  });
  assert.deepEqual(validateWidgetContent(free.data.content), []);
  assert.equal(free.data.content.components.filter((c) => c.type === 'button').length, 0);
  for (const settings of [{}, { device: world.gladys.externalIds(EQ, 'QP000003').device }]) {
    const other = await world.gladys.fake.widgetGet(WIDGET_KEY, { settings, language: 'es' });
    assert.deepEqual(validateWidgetContent(other.data.content), []);
    assert.equal(other.data.content.components[0].type, 'text');
  }
});

test('an expired token is refreshed, and a restart reuses the saved one', async () => {
  const world = await createWorld();
  const logins = () => world.easee.paths().filter((p) => p === '/api/accounts/login').length;
  assert.equal(logins(), 1);
  world.advance(24 * 60 * MINUTE);
  await world.app.cycle();
  assert.ok(world.easee.paths().includes('/api/accounts/refresh_token'));
  assert.equal(logins(), 1);
  assert.ok((await world.tokenStore.load()).accessToken.startsWith('access-'));
});
