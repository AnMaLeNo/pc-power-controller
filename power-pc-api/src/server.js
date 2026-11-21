const fastify = require('fastify')({ logger: true });
const mqtt = require('mqtt');

const PORT = Number(process.env.PORT) || 3000;
const MQTT_HOST = process.env.MQTT_HOST || 'localhost';
const MQTT_PORT = Number(process.env.MQTT_PORT) || 1883;

const mqttClient = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`);

const TOPIC_COMMAND = 'bureau/pc/power/set';
const TOPIC_LOG = 'bureau/pc/power/log';
const TOPIC_STATUS = 'bureau/pc/power/status';

// ── Système de démarrage ──
// Le « sélecteur de démarrage » du PC lit, à chaque mise sous tension, le
// système souhaité sur <préfixe>/target (message retenu, écrit par cette API)
// puis rend compte de son choix sur <préfixe>/status (message retenu, écrit par
// le sélecteur). Aucun autre stockage : l'état vit dans le broker.
const BOOT_TOPIC_PREFIX = (process.env.BOOT_TOPIC_PREFIX || 'bureau/pc/boot').replace(/\/+$/, '');
if (!BOOT_TOPIC_PREFIX || /[#+]/.test(BOOT_TOPIC_PREFIX)) {
  throw new Error(`BOOT_TOPIC_PREFIX invalide : "${process.env.BOOT_TOPIC_PREFIX}"`);
}
const TOPIC_BOOT_TARGET = `${BOOT_TOPIC_PREFIX}/target`;
const TOPIC_BOOT_STATUS = `${BOOT_TOPIC_PREFIX}/status`;

// BOOT_SYSTEMS : liste « id:Libellé » séparée par des virgules. Une liste
// invalide arrête le démarrage plutôt que d'ignorer un système en silence.
const parseBootSystems = (raw) => {
  const systems = raw.split(',').map((pair) => {
    const [id, ...rest] = pair.trim().split(':');
    const label = rest.join(':').trim();
    if (!/^[a-z0-9-]+$/.test(id) || !label) {
      throw new Error(`BOOT_SYSTEMS invalide : "${pair}" (attendu id:Libellé, id en [a-z0-9-]+)`);
    }
    return { id, label };
  });
  const ids = systems.map((system) => system.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`BOOT_SYSTEMS invalide : identifiant en double dans "${raw}"`);
  }
  return systems;
};
const BOOT_SYSTEMS = parseBootSystems(
  process.env.BOOT_SYSTEMS || 'windows:Windows,ubuntu:Ubuntu,agent:Agent'
);

// Clients SSE connectés (réponses HTTP gardées ouvertes pour le push temps réel)
const sseClients = new Set();

// Dernier état de présence du contrôleur ("online" à la naissance, "offline"
// via Last Will ; messages retenus par le broker). Resservi à chaque client
// SSE qui se connecte pour qu'il démarre synchronisé.
let lastStatus = null;

// Dernier souhait de démarrage retenu par le broker (événement boot_target) et
// dernier compte rendu du sélecteur ; null tant que le broker n'en détient pas.
// Resservis eux aussi à chaque nouveau client SSE.
let bootTarget = null;
let bootStatus = null;
let bootStatusRaw = null;

// Diffuse un événement à tous les clients SSE connectés.
const broadcast = (event) => {
  const data = JSON.stringify(event);
  for (const client of sseClients) {
    client.raw.write(`data: ${data}\n\n`);
  }
};

// Heartbeat SSE : un commentaire (`:`) ignoré par EventSource mais qui génère
// du trafic. Garde la connexion vivante à travers les proxies et fait échouer
// l'écriture sur un client mort -> détection des connexions zombies.
const SSE_HEARTBEAT_MS = 30000;
const heartbeat = setInterval(() => {
  for (const client of sseClients) client.raw.write(': ping\n\n');
}, SSE_HEARTBEAT_MS);
heartbeat.unref();

mqttClient.on('connect', () => {
  fastify.log.info('Connecté au Broker MQTT');
  mqttClient.subscribe([TOPIC_LOG, TOPIC_STATUS], (err) => {
    if (err) fastify.log.error({ err }, `Échec subscribe ${TOPIC_LOG} / ${TOPIC_STATUS}`);
    else fastify.log.info(`Abonné aux topics ${TOPIC_LOG} et ${TOPIC_STATUS}`);
  });
  mqttClient.subscribe([TOPIC_BOOT_TARGET, TOPIC_BOOT_STATUS], { qos: 1 }, (err) => {
    if (err) fastify.log.error({ err }, `Échec subscribe ${TOPIC_BOOT_TARGET} / ${TOPIC_BOOT_STATUS}`);
    else fastify.log.info(`Abonné aux topics ${TOPIC_BOOT_TARGET} et ${TOPIC_BOOT_STATUS}`);
  });
});

mqttClient.on('error', (err) => {
  fastify.log.error('Erreur MQTT:', err);
});

// Souhait de démarrage. L'API est abonnée au topic qu'elle écrit : l'écho du
// broker est la seule source de vérité, qu'il vienne de cette API ou d'un autre
// client. `replayed` vaut pour un message retenu resservi à l'abonnement
// (démarrage de l'API, reconnexion) : s'il n'apprend rien, on l'ignore.
// Payload vide = message retenu effacé = plus de souhait.
const handleBootTarget = (raw, replayed) => {
  const target = raw === '' ? null : raw;
  if (replayed && bootTarget && bootTarget.target === target) return;
  const event = { event: 'boot_target', target, timestamp: new Date().toISOString() };
  bootTarget = target === null ? null : event;
  broadcast(event);
};

// Forme SSE du compte rendu : `event` sert à l'aiguillage côté navigateur, le
// champ `event` du sélecteur (« selected », ou « raw ») passe dans `selector_event`.
const toBootStatusEvent = (status) => ({
  ...status,
  event: 'boot_status',
  selector_event: status.event
});

// Compte rendu du sélecteur : JSON attendu, texte brut toléré (même repli que
// pour le journal de l'ESP). Le sélecteur ne date pas ses messages : `timestamp`
// est l'heure de réception par l'API, et `retained` signale un compte rendu
// déjà présent sur le broker à l'abonnement, donc plus ancien que ce timestamp.
const handleBootStatus = (raw, replayed) => {
  const timestamp = new Date().toISOString();
  if (raw === '') {
    bootStatus = null;
    bootStatusRaw = null;
    broadcast({ event: 'boot_status', selector_event: null, timestamp });
    return;
  }
  if (replayed && raw === bootStatusRaw) return;

  let report;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.event === 'string') report = parsed;
  } catch {
    // payload non-JSON : fallback texte brut
  }
  if (!report) report = { event: 'raw', message: raw };

  bootStatus = { ...report, timestamp, retained: replayed };
  bootStatusRaw = raw;
  broadcast(toBootStatusEvent(bootStatus));
};

// Relais des retours de l'ESP (topic log) vers tous les clients SSE connectés.
// L'ESP publie un JSON structuré ({event, action?, ts?, reason?}). L'API le
// décode et expose un objet typé au front. Fallback: si le payload n'est pas du
// JSON (ancien firmware), on le relaie en texte brut pour ne pas perdre l'info.
mqttClient.on('message', (topic, payload, packet) => {
  // Présence du contrôleur : relayée telle quelle au front sous forme d'un
  // événement status typé.
  if (topic === TOPIC_STATUS) {
    lastStatus = {
      event: 'status',
      online: payload.toString() === 'online',
      timestamp: new Date().toISOString()
    };
    broadcast(lastStatus);
    return;
  }

  if (topic === TOPIC_BOOT_TARGET) {
    handleBootTarget(payload.toString(), packet.retain);
    return;
  }

  if (topic === TOPIC_BOOT_STATUS) {
    handleBootStatus(payload.toString(), packet.retain);
    return;
  }

  if (topic !== TOPIC_LOG) return;
  const raw = payload.toString();

  let event;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.event === 'string') {
      event = { ...parsed, timestamp: new Date().toISOString() };
    }
  } catch {
    // payload non-JSON : fallback texte brut
  }
  if (!event) {
    event = { event: 'raw', message: raw, timestamp: new Date().toISOString() };
  }

  broadcast(event);
});

const powerSchema = {
  body: {
    type: 'object',
    required: ['action'],
    additionalProperties: false,
    properties: {
      action: { type: 'string', enum: ['SHORT_PRESS', 'LONG_PRESS'] }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        message: { type: 'string' },
        topic: { type: 'string' },
        timestamp: { type: 'string' }
      }
    },
    503: {
      type: 'object',
      properties: {
        error: { type: 'string' },
        code: { type: 'string' }
      }
    },
    502: {
      description: 'Bad Gateway - Échec de la transmission MQTT',
      type: 'object',
      properties: {
        error: { type: 'string' }
      }
    },
  }
};

const bootSchema = {
  body: {
    type: 'object',
    required: ['target'],
    additionalProperties: false,
    properties: {
      target: { type: 'string', enum: BOOT_SYSTEMS.map((system) => system.id) }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        target: { type: 'string' },
        topic: { type: 'string' },
        timestamp: { type: 'string' }
      }
    },
    503: {
      type: 'object',
      properties: {
        error: { type: 'string' },
        code: { type: 'string' }
      }
    },
    502: {
      description: 'Bad Gateway - Échec de la transmission MQTT',
      type: 'object',
      properties: {
        error: { type: 'string' }
      }
    },
  }
};

fastify.get('/health', async (request, reply) => {
  const mqttUp = mqttClient.connected;
  reply.code(mqttUp ? 200 : 503).send({
    status: mqttUp ? 'ok' : 'degraded',
    mqtt: mqttUp ? 'connected' : 'disconnected'
  });
});

fastify.post('/api/power', { schema: powerSchema }, async (request, reply) => {
  const { action } = request.body;

  if (!mqttClient.connected) {
    reply.code(503).send({
      error: 'Service MQTT indisponible',
      code: 'MQTT_DISCONNECTED'
    });
    return ;
  }

  try {
    await mqttClient.publishAsync(TOPIC_COMMAND, action, { qos: 1 });
    return {
      status: 'success',
      message: `Commande ${action} acquittée par le broker`,
      topic: TOPIC_COMMAND,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    fastify.log.error({ err, topic: TOPIC_COMMAND, action }, 'Échec de la publication MQTT');
    reply.code(502).send({
      error: 'Erreur lors de l\'envoi MQTT'
    });
  }
});

// Système de démarrage : souhait retenu, systèmes proposés, dernier compte
// rendu du sélecteur. `mqtt` permet au front de distinguer « aucun souhait »
// de « broker injoignable » (target vaut null dans les deux cas).
fastify.get('/api/boot', async () => ({
  target: bootTarget ? bootTarget.target : null,
  systems: BOOT_SYSTEMS,
  status: bootStatus,
  mqtt: mqttClient.connected ? 'connected' : 'disconnected'
}));

fastify.put('/api/boot', { schema: bootSchema }, async (request, reply) => {
  const { target } = request.body;

  if (!mqttClient.connected) {
    reply.code(503).send({
      error: 'Service MQTT indisponible',
      code: 'MQTT_DISCONNECTED'
    });
    return ;
  }

  try {
    await mqttClient.publishAsync(TOPIC_BOOT_TARGET, target, { qos: 1, retain: true });
    return {
      status: 'success',
      target,
      topic: TOPIC_BOOT_TARGET,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    fastify.log.error({ err, topic: TOPIC_BOOT_TARGET, target }, 'Échec de la publication MQTT');
    reply.code(502).send({
      error: 'Erreur lors de l\'envoi MQTT'
    });
  }
});

// Flux SSE : pousse en temps réel les retours de l'ESP (Server -> navigateur)
fastify.get('/api/events', (request, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  reply.raw.write('retry: 3000\n\n');

  // Synchronisation immédiate du nouveau client avec la présence du contrôleur.
  if (lastStatus) {
    reply.raw.write(`data: ${JSON.stringify(lastStatus)}\n\n`);
  }
  // Idem pour le souhait de démarrage et le dernier compte rendu du sélecteur.
  if (bootTarget) {
    reply.raw.write(`data: ${JSON.stringify(bootTarget)}\n\n`);
  }
  if (bootStatus) {
    reply.raw.write(`data: ${JSON.stringify(toBootStatusEvent(bootStatus))}\n\n`);
  }

  sseClients.add(reply);
  fastify.log.info(`Client SSE connecté (${sseClients.size} actif(s))`);

  request.raw.on('close', () => {
    sseClients.delete(reply);
    fastify.log.info(`Client SSE déconnecté (${sseClients.size} actif(s))`);
  });
});

const closeGracefully = async (signal) => {
  fastify.log.info(`Signal ${signal} reçu. Arrêt en cours...`);

  clearInterval(heartbeat);
  for (const client of sseClients) client.raw.end();
  sseClients.clear();

  await fastify.close();

  if (mqttClient.connected) {
    mqttClient.end(false, () => {
      fastify.log.info('Client MQTT déconnecté.');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
};

['SIGINT', 'SIGTERM'].forEach(signal => {
  process.on(signal, () => closeGracefully(signal));
});

const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
