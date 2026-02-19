const Redis = require('redis');
const logger = require('../utils/logger');

const redisClient = Redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  password: process.env.REDIS_PASSWORD || undefined,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        logger.error('Redis: Too many reconnection attempts');
        return new Error('Too many reconnection attempts');
      }
      return Math.min(retries * 50, 500);
    }
  }
});

redisClient.on('error', (err) => {
  logger.error(`Redis Error: ${err.message}`);
});

redisClient.on('connect', () => {
  logger.info('Redis: Connected');
});

redisClient.on('reconnecting', () => {
  logger.warn('Redis: Reconnecting...');
});

redisClient.on('ready', () => {
  logger.info('Redis: Ready to use');
});

// Connect to Redis
(async () => {
  try {
    await redisClient.connect();
  } catch (error) {
    logger.error(`Redis connection failed: ${error.message}`);
  }
})();

module.exports = redisClient;
