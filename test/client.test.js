// -----------------------------------------------------------------------------
// The Easee API client (src/easee/client.js) against the fake Easee cloud.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EaseeError,
  accountKey,
  createEaseeClient,
  memoryTokenStore,
  retryAfterMs,
} from '../src/easee/client.js';
import { ACCOUNT, createFakeEasee } from './helpers/fakeEasee.js';

function setup({ password = ACCOUNT.password, tokenStore = memoryTokenStore(), now } = {}) {
  const easee = createFakeEasee();
  const clock = { now: Date.parse('2026-10-14T18:43:00Z') };
  const client = createEaseeClient({
    username: ACCOUNT.username,
    password,
    fetch: easee.fetch,
    tokenStore,
    now: now ?? (() => clock.now),
  });
  return { easee, client, clock, tokenStore };
}

test('logs in once, then sends the token with every call', async () => {
  const { easee, client } = setup();
  await client.getChargers();
  await client.getChargerState('EH000001');
  assert.deepEqual(easee.paths(), [
    '/api/accounts/login',
    '/api/chargers',
    '/api/chargers/EH000001/state',
  ]);
  assert.deepEqual(easee.requests[0].body, {
    userName: ACCOUNT.username,
    password: ACCOUNT.password,
  });
  assert.equal(easee.requests[0].auth, undefined, 'no token on the login');
  assert.equal(easee.requests[1].auth, 'Bearer access-1');
});

test('refused credentials are an auth error, without the password in the message', async () => {
  const { easee, client } = setup({ password: 'wrong password' });
  await assert.rejects(client.getChargers(), (err) => {
    assert.ok(err instanceof EaseeError);
    assert.equal(err.kind, 'auth');
    assert.equal(err.status, 400);
    assert.ok(!err.message.includes('wrong password'));
    return true;
  });
  assert.deepEqual(easee.paths(), ['/api/accounts/login']);
});

test('an expired token is refreshed before the call, a 401 after a refresh then a login', async () => {
  const { easee, client, clock } = setup();
  await client.getChargers();
  clock.now += 24 * 3600 * 1000;
  await client.getChargers();
  assert.ok(easee.paths().includes('/api/accounts/refresh_token'));

  // Easee revoked every token: 401, refresh refused, new login.
  easee.validTokens.clear();
  await client.getChargers();
  assert.equal(easee.paths().filter((p) => p === '/api/accounts/login').length, 2);
});

test('the token is saved for the account and reused after a restart', async () => {
  const tokenStore = memoryTokenStore();
  const first = setup({ tokenStore });
  await first.client.getChargers();
  const saved = await tokenStore.load();
  assert.equal(saved.account, accountKey(ACCOUNT.username));
  assert.ok(!JSON.stringify(saved).includes(ACCOUNT.password), 'no password in the token file');

  const second = createEaseeClient({
    username: ACCOUNT.username,
    password: ACCOUNT.password,
    fetch: first.easee.fetch,
    tokenStore,
    now: () => first.clock.now,
  });
  first.easee.requests.length = 0;
  await second.getChargers();
  assert.deepEqual(first.easee.paths(), ['/api/chargers'], 'no new login');

  // Another account does not take it.
  const other = createEaseeClient({
    username: 'someone-else@example.com',
    password: 'x',
    fetch: first.easee.fetch,
    tokenStore,
  });
  await assert.rejects(other.getChargers(), { kind: 'auth' });
});

test('parallel calls share one login', async () => {
  const { easee, client } = setup();
  await Promise.all([
    client.getChargers(),
    client.getProducts(),
    client.getChargerState('EH000001'),
  ]);
  assert.equal(easee.paths().filter((p) => p === '/api/accounts/login').length, 1);
});

test('errors are typed: rate limit with its delay, outage, refused, not found, network', async () => {
  const { easee, client } = setup();
  await client.connect();
  easee.fail.push({ status: 429, headers: { 'retry-after': '30' } });
  await assert.rejects(client.getChargers(), { kind: 'rate_limit', retryAfterMs: 30000 });
  easee.fail.push({ status: 503 });
  await assert.rejects(client.getChargers(), { kind: 'server', status: 503 });
  easee.fail.push({ status: 400, body: { title: 'Charger is offline' } });
  await assert.rejects(client.command('EH000001', 'pause_charging'), {
    kind: 'refused',
    message: 'Command pause_charging failed (HTTP 400: Charger is offline)',
  });
  await assert.rejects(client.getChargerState('EH999999'), { kind: 'not_found' });
  easee.fail.push({ network: true });
  await assert.rejects(client.getChargers(), { kind: 'network' });
  assert.throws(() => client.command('EH000001', 'reboot'), /Unknown Easee command/);
});

test('commands and settings go to the documented endpoints', async () => {
  const { easee, client } = setup();
  await client.command('EH000001', 'resume_charging');
  await client.setSettings('EH000001', { dynamicChargerCurrent: 12 });
  const posts = easee.requests.filter((r) => r.method === 'POST' && r.auth);
  assert.deepEqual(
    posts.map((r) => [r.path, r.body]),
    [
      ['/api/chargers/EH000001/commands/resume_charging', undefined],
      ['/api/chargers/EH000001/settings', { dynamicChargerCurrent: 12 }],
    ],
  );
});

test('Retry-After in seconds or as a date', () => {
  assert.equal(retryAfterMs('120'), 120000);
  assert.equal(retryAfterMs(undefined), undefined);
  assert.equal(
    retryAfterMs('Wed, 14 Oct 2026 18:45:00 GMT', Date.parse('2026-10-14T18:44:00Z')),
    60000,
  );
  assert.equal(retryAfterMs('soon'), undefined);
});
