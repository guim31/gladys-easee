// -----------------------------------------------------------------------------
// Client of the Easee cloud API (https://api.easee.com), the same REST API the
// Easee app, pyeasee (Home Assistant) and evcc use.
//
//   - Login: POST /api/accounts/login with the account's e-mail address (or
//     phone number) and password; the answer is an access token (about one
//     day) and a refresh token. Both are kept in /data (src/store.js) so a
//     restart does not log in again.
//   - Every call carries the access token. Expired: refreshed first
//     (POST /api/accounts/refresh_token), and a 401 is retried once after a
//     refresh, then after a new login.
//   - Errors are typed (EaseeError.kind) so the callers can tell refused
//     credentials (stop and say so: retrying could lock the account) from a
//     rate limit (wait), a cloud outage (retry later) or a refused command.
//
// Nothing here logs: the messages of the errors carry the HTTP status and the
// title Easee gives, never a token, a password or the request body.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

export const EASEE_API = 'https://api.easee.com';

/** Refresh the access token this long before it expires. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15000;

/** Charger commands of the API (POST /api/chargers/{id}/commands/{name}). */
export const COMMANDS = ['start_charging', 'stop_charging', 'pause_charging', 'resume_charging'];

export class EaseeError extends Error {
  /**
   * @param {'auth'|'rate_limit'|'refused'|'not_found'|'server'|'network'} kind
   * @param {string} message
   * @param {{ status?: number, retryAfterMs?: number }} [details]
   */
  constructor(kind, message, { status, retryAfterMs } = {}) {
    super(message);
    this.name = 'EaseeError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Short, stable fingerprint of an account: the token file belongs to one. */
export function accountKey(username) {
  return createHash('sha256').update(String(username)).digest('hex').slice(0, 16);
}

/**
 * @param {object} options
 * @param {string} options.username
 * @param {string} options.password
 * @param {{ load: () => Promise<object|null>, save: (t: object) => Promise<void>, clear: () => Promise<void> }} [options.tokenStore]
 * @param {typeof fetch} [options.fetch]
 * @param {string} [options.baseUrl]
 * @param {string} [options.userAgent]
 * @param {() => number} [options.now]
 * @param {number} [options.timeoutMs]
 */
export function createEaseeClient({
  username,
  password,
  tokenStore = memoryTokenStore(),
  fetch: fetchImpl = globalThis.fetch,
  baseUrl = EASEE_API,
  userAgent = 'gladys-easee',
  now = () => Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const account = accountKey(username);
  let token = null;
  let loaded = false;
  // One login or refresh at a time: parallel calls wait for the same one.
  let renewing = null;

  async function send(method, path, { body, auth = true } = {}) {
    const headers = { Accept: 'application/json', 'User-Agent': userAgent };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (auth) {
      headers.Authorization = `Bearer ${token.accessToken}`;
    }
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code ?? err?.message);
      throw new EaseeError('network', `Easee cloud unreachable (${reason})`);
    }
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { status: response.status, ok: response.ok, headers: response.headers, data };
  }

  function errorFrom(res, what) {
    const title = typeof res.data === 'object' && res.data ? res.data.title : undefined;
    const detail = title ? `: ${String(title).slice(0, 120)}` : '';
    const message = `${what} failed (HTTP ${res.status}${detail})`;
    if (res.status === 429) {
      return new EaseeError('rate_limit', message, {
        status: 429,
        retryAfterMs: retryAfterMs(res.headers?.get?.('retry-after')),
      });
    }
    if (res.status === 404) {
      return new EaseeError('not_found', message, { status: 404 });
    }
    if (res.status >= 500) {
      return new EaseeError('server', message, { status: res.status });
    }
    return new EaseeError('refused', message, { status: res.status });
  }

  function storeToken(data) {
    if (!data || typeof data.accessToken !== 'string' || !data.accessToken) {
      throw new EaseeError('server', 'Easee login answered without a token');
    }
    const expiresIn = Number(data.expiresIn);
    token = {
      account,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken ?? null,
      expiresAt: now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 3600000),
    };
    return tokenStore.save(token).catch(() => {});
  }

  async function login() {
    const res = await send('POST', '/api/accounts/login', {
      body: { userName: username, password },
      auth: false,
    });
    if (!res.ok) {
      // 400 (errorCode 100, "invalid username or password") and 401/403 all
      // mean the account refuses these credentials.
      if ([400, 401, 403].includes(res.status)) {
        token = null;
        await tokenStore.clear().catch(() => {});
        throw new EaseeError('auth', `Easee refused the credentials (HTTP ${res.status})`, {
          status: res.status,
        });
      }
      throw errorFrom(res, 'Easee login');
    }
    await storeToken(res.data);
  }

  async function refresh() {
    if (!token?.refreshToken) {
      return login();
    }
    const res = await send('POST', '/api/accounts/refresh_token', {
      body: { accessToken: token.accessToken, refreshToken: token.refreshToken },
      auth: false,
    });
    if (!res.ok) {
      if (res.status === 429 || res.status >= 500) {
        throw errorFrom(res, 'Easee token refresh');
      }
      // A refused refresh token: log in again.
      return login();
    }
    return storeToken(res.data);
  }

  function renew(how) {
    if (!renewing) {
      renewing = how().finally(() => {
        renewing = null;
      });
    }
    return renewing;
  }

  async function ensureToken() {
    if (!loaded) {
      loaded = true;
      const saved = await tokenStore.load().catch(() => null);
      if (saved?.account === account && saved.accessToken) {
        token = saved;
      }
    }
    if (!token) {
      await renew(login);
    } else if (token.expiresAt - EXPIRY_MARGIN_MS <= now()) {
      await renew(refresh);
    }
  }

  async function call(method, path, what, body) {
    await ensureToken();
    let res = await send(method, path, { body });
    if (res.status === 401) {
      await renew(refresh);
      res = await send(method, path, { body });
    }
    if (!res.ok) {
      throw errorFrom(res, what);
    }
    return res.data;
  }

  const id = (value) => encodeURIComponent(String(value));

  return {
    /** Check the credentials: logs in when no valid token is known. */
    async connect() {
      await ensureToken();
    },
    /** Chargers the account can see: [{ id, name, productCode, ... }]. */
    async getChargers() {
      const data = await call('GET', '/api/chargers', 'Reading the chargers');
      return Array.isArray(data) ? data : [];
    },
    /** Sites with their circuits and equalizers. */
    async getProducts() {
      const data = await call('GET', '/api/accounts/products', 'Reading the sites');
      return Array.isArray(data) ? data : [];
    },
    getChargerState(chargerId) {
      return call('GET', `/api/chargers/${id(chargerId)}/state`, 'Reading the charger state');
    },
    getChargerConfig(chargerId) {
      return call('GET', `/api/chargers/${id(chargerId)}/config`, 'Reading the charger settings');
    },
    getEqualizerState(equalizerId) {
      return call('GET', `/api/equalizers/${id(equalizerId)}/state`, 'Reading the Equalizer state');
    },
    /** start_charging, stop_charging, pause_charging or resume_charging. */
    command(chargerId, name) {
      if (!COMMANDS.includes(name)) {
        throw new Error(`Unknown Easee command ${name}`);
      }
      return call('POST', `/api/chargers/${id(chargerId)}/commands/${name}`, `Command ${name}`);
    },
    /** Charger settings: { enabled }, { dynamicChargerCurrent }... */
    setSettings(chargerId, settings) {
      return call(
        'POST',
        `/api/chargers/${id(chargerId)}/settings`,
        'Changing the charger settings',
        settings,
      );
    },
  };
}

/** Retry-After in milliseconds (seconds or an HTTP date), undefined when absent. */
export function retryAfterMs(header, now = Date.now()) {
  if (header === null || header === undefined || header === '') {
    return undefined;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/** A token store that forgets everything at exit (tests, probe). */
export function memoryTokenStore() {
  let saved = null;
  return {
    async load() {
      return saved;
    },
    async save(token) {
      saved = { ...token };
    },
    async clear() {
      saved = null;
    },
  };
}
