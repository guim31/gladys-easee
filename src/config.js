// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys from the manifest `config_schema`. The SDK
// fetches it (`gladys.getConfig()`) and pushes every change
// (`gladys.onConfigUpdated()`); this module only provides the defaults and
// normalizes the received object, so the rest of the code never deals with
// `undefined` or with numbers typed as strings.
// -----------------------------------------------------------------------------

/** The languages of the Gladys interface, in the order every text carries them. */
export const LANGUAGES = ['en', 'fr', 'de', 'es'];

/** Refresh intervals offered in the configuration, in seconds (select values). */
export const POLL_INTERVALS = ['60', '120', '300'];

// MUST stay equal to the `default` values of the manifest config_schema
// (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  username: '', // e-mail address or phone number of the Easee account
  password: '',
  language: 'fr', // language of the feature names and of the texts built here
  poll_interval: '60', // seconds between two readings of the Easee cloud
};

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} [raw] config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw ?? {};
  const language = String(source.language ?? DEFAULT_CONFIG.language);
  const interval = String(source.poll_interval ?? DEFAULT_CONFIG.poll_interval);
  return {
    // Easee accepts an e-mail address or a phone number: no case change, a
    // phone number has none and an e-mail address is matched as typed.
    username: String(source.username ?? DEFAULT_CONFIG.username).trim(),
    password: String(source.password ?? DEFAULT_CONFIG.password),
    language: LANGUAGES.includes(language) ? language : DEFAULT_CONFIG.language,
    poll_interval: POLL_INTERVALS.includes(interval) ? interval : DEFAULT_CONFIG.poll_interval,
  };
}

/** The account can only be reached once both fields are filled in. */
export function isConfigured(config) {
  return Boolean(config.username && config.password);
}

/** Period of the container's own refresh timer, in milliseconds. */
export function pollPeriodMs(config) {
  return Number(config.poll_interval) * 1000;
}
