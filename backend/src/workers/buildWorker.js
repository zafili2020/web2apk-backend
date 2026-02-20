const buildQueue = require('../config/queue');
const Build = require('../models/Build');
const logger = require('../utils/logger');
const { buildAPK } = require('../services/buildService');
const mongoose = require('mongoose');

// Connect to MongoDB before processing jobs
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info('Worker: Connected to MongoDB');
  } catch (error) {
    logger.error(`Worker: MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
};

// Initialize database connection
connectDB();

/**
 * Process build job
 */
buildQueue.process(async (job) => {
  const { buildId, userId, appConfig, features, isPremium } = job.data;

  logger.info(`Processing build: ${buildId}`);

  try {
    // Get build from database
    const build = await Build.findOne({ buildId });
    
    if (!build) {
      throw new Error('Build not found in database');
    }

    // Update status to building
    build.status = 'building';
    build.progress = 10;
    build.currentStep = 'Preparing build environment...';
    await build.save();

    // Update progress callback
    const updateProgress = async (progress, step) => {
      await build.updateProgress(progress, step);
      job.progress(progress);
    };

    // Build the APK
    const result = await buildAPK({
      buildId,
      appConfig,
      features,
      isPremium,
      updateProgress
    });

    // Mark build as completed
    await build.markCompleted(
      result.apkPath,
      result.apkSize,
      result.downloadUrl
    );

    logger.info(`Build completed: ${buildId}`);

    return {
      success: true,
      buildId,
      apkPath: result.apkPath,
      apkSize: result.apkSize,
      downloadUrl: result.downloadUrl
    };

  } catch (error) {
    logger.error(`Build failed: ${buildId} - ${error.message}`);
    logger.error(error.stack);

    // Get build from database
    const build = await Build.findOne({ buildId });
    
    if (build) {
      await build.markFailed(error);
    }

    throw error;
  }
});

// Queue event handlers
buildQueue.on('completed', (job, result) => {
  logger.info(`Job ${job.id} completed:`, result);
});

buildQueue.on('failed', (job, err) => {
  logger.error(`Job ${job.id} failed:`, err.message);
});

buildQueue.on('stalled', (job) => {
  logger.warn(`Job ${job.id} has stalled and will be reprocessed`);
});

logger.info('Build worker started and listening for jobs...');

// Keep the process alive
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing build worker gracefully...');
  await buildQueue.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, closing build worker gracefully...');
  await buildQueue.close();
  process.exit(0);
});
