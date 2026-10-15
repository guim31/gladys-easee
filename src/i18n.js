// -----------------------------------------------------------------------------
// Every text the integration shows, in the four languages of the Gladys
// interface (en, fr, de, es). German says "du", Spanish says "usted", like the
// rest of guim31's integrations. The vocabulary follows the Gladys interface
// (front/src/config/i18n): "Ladestation", "Estación de carga"...
//
//   - NAMES    : the feature names, frozen when the user adds the device: the
//                language comes from the `language` field of the config;
//   - STATUS   : the detailed status of a charger (text feature, widget);
//   - TEXT     : the fixed texts (widget, configuration screen, actions);
//   - MESSAGES : the texts built from a value;
//   - thrown() : a THROWN message reaches the screen as a plain string, the
//                core cannot localize it: the languages are joined.
//
// test/i18n.test.js checks that every entry carries exactly the four
// languages, none empty, none too long, and no polite German.
// -----------------------------------------------------------------------------

import { LANGUAGES } from './config.js';

export { LANGUAGES };

/** Feature names, by language then feature key. */
export const NAMES = {
  en: {
    connector: 'Connector',
    charging_state: 'Charging state',
    status: 'Easee status',
    power: 'Charging power',
    current_l1: 'Current L1',
    current_l2: 'Current L2',
    current_l3: 'Current L3',
    session_energy: 'Session energy',
    lifetime_energy: 'Total energy',
    target_current: 'Current limit',
    charge: 'Charging allowed',
    enabled: 'Charger enabled',
    import_power: 'Grid import',
    export_power: 'Grid export',
    import_index: 'Imported energy',
    export_index: 'Exported energy',
  },
  fr: {
    connector: 'Connecteur',
    charging_state: 'État de la charge',
    status: 'Statut Easee',
    power: 'Puissance de charge',
    current_l1: 'Intensité L1',
    current_l2: 'Intensité L2',
    current_l3: 'Intensité L3',
    session_energy: 'Énergie de la session',
    lifetime_energy: 'Énergie totale',
    target_current: 'Limite de courant',
    charge: 'Charge autorisée',
    enabled: 'Borne activée',
    import_power: 'Import réseau',
    export_power: 'Export réseau',
    import_index: 'Énergie importée',
    export_index: 'Énergie exportée',
  },
  de: {
    connector: 'Anschluss',
    charging_state: 'Ladezustand',
    status: 'Easee-Status',
    power: 'Ladeleistung',
    current_l1: 'Strom L1',
    current_l2: 'Strom L2',
    current_l3: 'Strom L3',
    session_energy: 'Energie der Ladung',
    lifetime_energy: 'Gesamtenergie',
    target_current: 'Stromgrenze',
    charge: 'Laden erlaubt',
    enabled: 'Ladestation aktiviert',
    import_power: 'Netzbezug',
    export_power: 'Netzeinspeisung',
    import_index: 'Bezogene Energie',
    export_index: 'Eingespeiste Energie',
  },
  es: {
    connector: 'Conector',
    charging_state: 'Estado de la carga',
    status: 'Estado Easee',
    power: 'Potencia de carga',
    current_l1: 'Intensidad L1',
    current_l2: 'Intensidad L2',
    current_l3: 'Intensidad L3',
    session_energy: 'Energía de la sesión',
    lifetime_energy: 'Energía total',
    target_current: 'Límite de corriente',
    charge: 'Carga autorizada',
    enabled: 'Cargador activado',
    import_power: 'Importación de red',
    export_power: 'Exportación a red',
    import_index: 'Energía importada',
    export_index: 'Energía exportada',
  },
};

/** Detailed status of a charger, by key (src/easee/model.js statusKey). */
export const STATUS = {
  offline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  disconnected: {
    en: 'No vehicle',
    fr: 'Aucun véhicule',
    de: 'Kein Fahrzeug',
    es: 'Sin vehículo',
  },
  awaitingStart: {
    en: 'Waiting to start',
    fr: 'En attente de démarrage',
    de: 'Wartet auf Start',
    es: 'Esperando el inicio',
  },
  charging: { en: 'Charging', fr: 'En charge', de: 'Lädt', es: 'Cargando' },
  completed: {
    en: 'Charging completed',
    fr: 'Charge terminée',
    de: 'Laden abgeschlossen',
    es: 'Carga terminada',
  },
  error: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  readyToCharge: {
    en: 'Ready to charge',
    fr: 'Prête à charger',
    de: 'Bereit zum Laden',
    es: 'Listo para cargar',
  },
  awaitingAuthorization: {
    en: 'Waiting for authorization',
    fr: "En attente d'autorisation",
    de: 'Wartet auf Freigabe',
    es: 'Esperando autorización',
  },
  deauthenticating: {
    en: 'Ending the session',
    fr: 'Fin de session',
    de: 'Sitzung wird beendet',
    es: 'Finalizando la sesión',
  },
  unknown: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
};

/** Fixed texts. */
export const TEXT = {
  // Widget
  status: { en: 'Status', fr: 'Statut', de: 'Status', es: 'Estado' },
  online: { en: 'Connection', fr: 'Connexion', de: 'Verbindung', es: 'Conexión' },
  onlineYes: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  onlineNo: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  power: { en: 'Power', fr: 'Puissance', de: 'Leistung', es: 'Potencia' },
  session: { en: 'Session', fr: 'Session', de: 'Ladung', es: 'Sesión' },
  limit: { en: 'Limit', fr: 'Limite', de: 'Grenze', es: 'Límite' },
  start: { en: 'Start', fr: 'Démarrer', de: 'Starten', es: 'Iniciar' },
  pause: { en: 'Pause', fr: 'Pause', de: 'Pause', es: 'Pausa' },
  resume: { en: 'Resume', fr: 'Reprendre', de: 'Fortsetzen', es: 'Reanudar' },
  stop: { en: 'Stop', fr: 'Arrêter', de: 'Stoppen', es: 'Detener' },
  pickCharger: {
    en: 'Choose a charger in the widget settings.',
    fr: 'Choisissez une borne dans les réglages du widget.',
    de: 'Wähle eine Ladestation in den Einstellungen des Widgets.',
    es: 'Elija un cargador en los ajustes del widget.',
  },
  notACharger: {
    en: 'This device is not an Easee charger: choose a charger in the widget settings.',
    fr: "Cet appareil n'est pas une borne Easee : choisissez une borne dans les réglages du widget.",
    de: 'Dieses Gerät ist keine Easee-Ladestation: Wähle eine Ladestation in den Einstellungen des Widgets.',
    es: 'Este dispositivo no es un cargador Easee: elija un cargador en los ajustes del widget.',
  },
  notConfigured: {
    en: 'Fill in the e-mail address (or phone number) and the password of the Easee account.',
    fr: "Renseignez l'adresse e-mail (ou le numéro de téléphone) et le mot de passe du compte Easee.",
    de: 'Gib die E-Mail-Adresse (oder Telefonnummer) und das Passwort des Easee-Kontos ein.',
    es: 'Introduzca la dirección de correo electrónico (o el número de teléfono) y la contraseña de la cuenta Easee.',
  },
  noReadingYet: {
    en: 'No reading from the Easee cloud yet.',
    fr: 'Pas encore de relevé du cloud Easee.',
    de: 'Noch keine Messung aus der Easee-Cloud.',
    es: 'Todavía no hay lecturas de la nube Easee.',
  },

  // Configuration screen
  authRefused: {
    en: 'Easee refused the e-mail address (or phone number) and password. Check them, then save the configuration again.',
    fr: "Easee a refusé l'adresse e-mail (ou le numéro de téléphone) et le mot de passe. Vérifiez-les, puis enregistrez de nouveau la configuration.",
    de: 'Easee hat die E-Mail-Adresse (oder Telefonnummer) und das Passwort abgelehnt. Prüfe sie und speichere die Konfiguration erneut.',
    es: 'Easee ha rechazado la dirección de correo electrónico (o el número de teléfono) y la contraseña. Compruébelos y vuelva a guardar la configuración.',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
    de: 'Die Initialisierung ist fehlgeschlagen, sieh dir die Logs der Integration an.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },

  // Thrown, joined by thrown(): short, a widget toast is 200 characters at most.
  noVehicle: {
    en: 'No vehicle connected.',
    fr: 'Aucun véhicule branché.',
    de: 'Kein Fahrzeug verbunden.',
    es: 'Ningún vehículo conectado.',
  },
  unknownCharger: {
    en: 'Unknown charger.',
    fr: 'Borne inconnue.',
    de: 'Unbekannte Ladestation.',
    es: 'Cargador desconocido.',
  },
  notConfiguredShort: {
    en: 'Easee account not configured.',
    fr: 'Compte Easee non configuré.',
    de: 'Easee-Konto nicht eingerichtet.',
    es: 'Cuenta Easee no configurada.',
  },
  commandRefused: {
    en: 'Easee refused the command.',
    fr: 'Easee a refusé la commande.',
    de: 'Easee hat den Befehl abgelehnt.',
    es: 'Easee ha rechazado la orden.',
  },
  cloudUnreachable: {
    en: 'Easee cloud unreachable.',
    fr: 'Cloud Easee injoignable.',
    de: 'Easee-Cloud nicht erreichbar.',
    es: 'Nube Easee inaccesible.',
  },
  rateLimited: {
    en: 'Too many requests to Easee, try again later.',
    fr: 'Trop de requêtes vers Easee, réessayez plus tard.',
    de: 'Zu viele Anfragen an Easee, versuche es später erneut.',
    es: 'Demasiadas solicitudes a Easee, inténtelo más tarde.',
  },
  badCurrent: {
    en: 'Current limit: 0 (pause) or 6 A to the maximum of the charger.',
    fr: 'Limite de courant : 0 (pause) ou de 6 A au maximum de la borne.',
    de: 'Stromgrenze: 0 (Pause) oder 6 A bis zum Maximum der Ladestation.',
    es: 'Límite de corriente: 0 (pausa) o de 6 A al máximo del cargador.',
  },
};

/** Texts built from a value. Each one returns the four languages. */
export const MESSAGES = {
  connected: (chargers, equalizers) => ({
    en: `Connected to Easee: ${chargers} charger(s), ${equalizers} Equalizer(s).`,
    fr: `Connecté à Easee : ${chargers} borne(s), ${equalizers} Equalizer(s).`,
    de: `Mit Easee verbunden: ${chargers} Ladestation(en), ${equalizers} Equalizer.`,
    es: `Conectado a Easee: ${chargers} cargador(es), ${equalizers} Equalizer(s).`,
  }),
  unreachable: (detail) => ({
    en: `Cannot reach the Easee cloud: ${detail}`,
    fr: `Impossible de joindre le cloud Easee : ${detail}`,
    de: `Die Easee-Cloud ist nicht erreichbar: ${detail}`,
    es: `No se puede acceder a la nube Easee: ${detail}`,
  }),
  commandSent: (command, name) => {
    const labels = {
      start_charging: { en: 'Start', fr: 'Démarrage', de: 'Start', es: 'Inicio' },
      resume_charging: { en: 'Resume', fr: 'Reprise', de: 'Fortsetzen', es: 'Reanudación' },
      pause_charging: { en: 'Pause', fr: 'Pause', de: 'Pause', es: 'Pausa' },
      stop_charging: { en: 'Stop', fr: 'Arrêt', de: 'Stopp', es: 'Parada' },
    }[command];
    return {
      en: `Command "${labels.en}" sent to ${name}.`,
      fr: `Commande « ${labels.fr} » envoyée à ${name}.`,
      de: `Befehl „${labels.de}“ an ${name} gesendet.`,
      es: `Orden «${labels.es}» enviada a ${name}.`,
    };
  },
};

/**
 * A text in one language (the configured one), English when missing.
 * @param {Record<string, string>} text
 * @param {string} language
 */
export function pick(text, language) {
  return text[language] ?? text.en;
}

/**
 * A message to THROW: the core shows a thrown message as a plain string, so
 * the four languages are joined.
 * @param {{ en: string, fr: string, de: string, es: string }} text
 * @returns {string}
 */
export function thrown(text) {
  return LANGUAGES.map((lang) => text[lang]).join(' / ');
}
