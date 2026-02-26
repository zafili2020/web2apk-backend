const Queue = require('bull');
const logger = require('../utils/logger');

// Create build queue
const buildQueue = new Queue('apk-builds', process.env.REDIS_URL || 'redis://localhost:6379', {
  defaultJobOptions: {
    attempts: parseInt(process.env.BUILD_QUEUE_ATTEMPTS) || 2,
    backoff: {
      type: 'exponential',
      delay: 2000
    },
    removeOnComplete: 100, // Keep last 100 completed jobs
    removeOnFail: 200,     // Keep last 200 failed jobs
    timeout: parseInt(process.env.BUILD_TIMEOUT_MS) || 900000 // 15 minutes (was 10)
  },
  settings: {
    lockDuration: 900000, // 15 minutes - must be >= timeout
    stalledInterval: 60000, // Check every 60 seconds
    maxStalledCount: 1 // Fail after 1 stall
  },
  limiter: {
    max: parseInt(process.env.MAX_CONCURRENT_BUILDS) || 3,
    duration: 1000
  }
});

// Queue event listeners
buildQueue.on('error', (error) => {
  logger.error(`Build Queue Error: ${error.message}`);
});

buildQueue.on('waiting', (jobId) => {
  logger.info(`Job ${jobId} is waiting`);
});

buildQueue.on('active', (job) => {
  logger.info(`Job ${job.id} has started processing`);
});

buildQueue.on('completed', (job, result) => {
  logger.info(`Job ${job.id} completed successfully`);
});

buildQueue.on('failed', (job, err) => {
  logger.error(`Job ${job.id} failed: ${err.message}`);
});

buildQueue.on('stalled', (job) => {
  logger.warn(`Job ${job.id} has stalled`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await buildQueue.close();
  logger.info('Build queue closed');
});

module.exports = buildQueue;
