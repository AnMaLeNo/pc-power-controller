const fastify = require('fastify')({ logger: true });
const mqtt = require('mqtt');

const PORT = Number(process.env.PORT) || 3000;
const MQTT_HOST = process.env.MQTT_HOST || 'localhost';
const MQTT_PORT = Number(process.env.MQTT_PORT) || 1883;

const mqttClient = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`);

const TOPIC_COMMAND = 'bureau/pc/power/set';
const TOPIC_LOG = 'bureau/pc/power/log';
const TOPIC_STATUS = 'bureau/pc/power/status';

// Clients SSE connectés (réponses HTTP gardées ouvertes pour le push temps réel)
const sseClients = new Set();

// Dernier état de présence du contrôleur ("online" à la naissance, "offline"
// via Last Will ; messages retenus par le broker). Resservi à chaque client
// SSE qui se connecte pour qu'il démarre synchronisé.
let lastStatus = null;

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
});

mqttClient.on('error', (err) => {
  fastify.log.error('Erreur MQTT:', err);
});

// Relais des retours de l'ESP (topic log) vers tous les clients SSE connectés.
// L'ESP publie un JSON structuré ({event, action?, ts?, reason?}). L'API le
// décode et expose un objet typé au front. Fallback: si le payload n'est pas du
// JSON (ancien firmware), on le relaie en texte brut pour ne pas perdre l'info.
mqttClient.on('message', (topic, payload) => {
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
