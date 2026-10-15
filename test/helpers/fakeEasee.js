// -----------------------------------------------------------------------------
// A fake Easee cloud, as a `fetch` implementation: no network in the tests.
//
// It serves the fixtures of test/fixtures/easee, checks the bearer token like
// the real API (401 without a valid one), and records every request. The
// tests change its data (a vehicle plugged in, a charger offline) or make it
// fail (`fail` = next answers) to drive the integration.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/easee/${name}.json`, import.meta.url), 'utf8'));

export const ACCOUNT = { username: 'owner@example.com', password: 'correct horse battery' };

export function createFakeEasee() {
  let tokenCount = 0;
  const easee = {
    username: ACCOUNT.username,
    password: ACCOUNT.password,
    validTokens: new Set(),
    chargers: fixture('chargers'),
    products: fixture('products'),
    states: {
      EH000001: fixture('charger-state-charging'),
      EC000002: fixture('charger-state-disconnected'),
    },
    configs: {
      EH000001: fixture('charger-config'),
      EC000002: { ...fixture('charger-config'), maxChargerCurrent: 16 },
    },
    equalizerStates: { QP000003: fixture('equalizer-state') },
    /** Every request: { method, path, body, auth }. */
    requests: [],
    /** Queued failures: { path?: RegExp, status, body?, headers? }, used once each. */
    fail: [],
    /** Answers of the token endpoints carry this lifetime, in seconds. */
    expiresIn: 86400,

    paths(method) {
      return easee.requests.filter((r) => !method || r.method === method).map((r) => r.path);
    },

    fetch: async (url, init = {}) => {
      const { pathname } = new URL(url);
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(init.body) : undefined;
      const auth = init.headers?.Authorization;
      easee.requests.push({ method, path: pathname, body, auth });

      const failure = easee.fail.findIndex((f) => !f.path || f.path.test(pathname));
      if (failure !== -1) {
        const [f] = easee.fail.splice(failure, 1);
        if (f.network) {
          throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
        }
        return respond(f.status, f.body ?? { title: 'Failure' }, f.headers);
      }

      if (method === 'POST' && pathname === '/api/accounts/login') {
        if (body.userName !== easee.username || body.password !== easee.password) {
          return respond(400, fixture('login-refused'));
        }
        return respond(200, newToken());
      }
      if (method === 'POST' && pathname === '/api/accounts/refresh_token') {
        if (!easee.validTokens.has(body.accessToken.replace('access', 'refresh'))) {
          return respond(400, { title: 'Invalid refresh token' });
        }
        return respond(200, newToken());
      }
      const token = auth?.replace(/^Bearer /, '');
      if (!easee.validTokens.has(token)) {
        return respond(401, { title: 'Unauthorized' });
      }

      let match;
      if (method === 'GET' && pathname === '/api/chargers') {
        return respond(200, easee.chargers);
      }
      if (method === 'GET' && pathname === '/api/accounts/products') {
        return respond(200, easee.products);
      }
      if ((match = pathname.match(/^\/api\/chargers\/([^/]+)\/state$/))) {
        return found(easee.states[match[1]]);
      }
      if ((match = pathname.match(/^\/api\/chargers\/([^/]+)\/config$/))) {
        return found(easee.configs[match[1]]);
      }
      if ((match = pathname.match(/^\/api\/equalizers\/([^/]+)\/state$/))) {
        return found(easee.equalizerStates[match[1]]);
      }
      if ((match = pathname.match(/^\/api\/chargers\/([^/]+)\/settings$/)) && method === 'POST') {
        const id = match[1];
        if (!easee.states[id]) {
          return respond(404, { title: 'Not found' });
        }
        if (body.dynamicChargerCurrent !== undefined) {
          easee.states[id] = {
            ...easee.states[id],
            dynamicChargerCurrent: body.dynamicChargerCurrent,
          };
        }
        if (body.enabled !== undefined) {
          easee.configs[id] = { ...easee.configs[id], isEnabled: body.enabled };
        }
        return respond(202, null);
      }
      if ((match = pathname.match(/^\/api\/chargers\/([^/]+)\/commands\/([a-z_]+)$/))) {
        const [, id, name] = match;
        const mode = {
          pause_charging: 2,
          resume_charging: 3,
          start_charging: 3,
          stop_charging: 4,
        }[name];
        if (!easee.states[id] || mode === undefined) {
          return respond(404, { title: 'Not found' });
        }
        easee.states[id] = { ...easee.states[id], chargerOpMode: mode };
        return respond(202, [{ device: id, commandId: 48, ticks: 638650000000000000 }]);
      }
      return respond(404, { title: 'Not found' });
    },
  };

  function newToken() {
    tokenCount += 1;
    const accessToken = `access-${tokenCount}`;
    easee.validTokens.add(accessToken);
    easee.validTokens.add(`refresh-${tokenCount}`);
    return {
      ...fixture('login-ok'),
      accessToken,
      refreshToken: `refresh-${tokenCount}`,
      expiresIn: easee.expiresIn,
    };
  }

  function found(data) {
    return data ? respond(200, data) : respond(404, { title: 'Not found' });
  }

  function respond(status, data, headers = {}) {
    return new Response(data === null ? '' : JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  }

  return easee;
}
