const fastify = require('fastify')({ logger: true });
const mqtt = require('mqtt');

const mqttClient = mqtt.connect(`mqtt://${process.env.MQTT_HOST}:${process.env.MQTT_PORT}`);

mqttClient.on('connect', () => {
  fastify.log.info('Connecté au Broker MQTT');
});

mqttClient.on('error', (err) => {
  fastify.log.error('Erreur MQTT:', err);
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

fastify.post('/api/power', { schema: powerSchema }, async (request, reply) => {
  const { action } = request.body;
  const topic = 'bureau/pc/power/set';

  if (!mqttClient.connected) {
    reply.code(503).send({ 
      error: 'Service MQTT indisponible',
      code: 'MQTT_DISCONNECTED'
    });
    return ;
  }

  try {
    await mqttClient.publishAsync(topic, action, { qos: 1 });
    return { 
      status: 'success', 
      message: `Commande ${action} acquittée par le broker`,  
      topic,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    fastify.log.error({ err, topic, action }, 'Échec de la publication MQTT');
    reply.code(502).send({
      error: 'Erreur lors de l\'envoi MQTT' 
    });
  }
});

const closeGracefully = async (signal) => {
  fastify.log.info(`Signal ${signal} reçu. Arrêt en cours...`);
  
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
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();