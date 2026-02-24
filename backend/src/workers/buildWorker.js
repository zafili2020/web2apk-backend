const buildQueue = require('../config/queue');
const Build = require('../models/Build');
const logger = require('../utils/logger');
const { buildAPK } = require('../services/buildService');
const mongoose = require('mongoose');
const http = require('http');

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

// Create simple health check server for DigitalOcean with download endpoint
const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

// Enable CORS for frontend
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'web2apk-worker',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'web2apk-worker',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Download endpoint
app.get('/download/:buildId', async (req, res) => {
  try {
    const { buildId } = req.params;
    
    // Find build in database
    const build = await Build.findOne({ buildId });
    
    if (!build) {
      return res.status(404).json({ success: false, message: 'Build not found' });
    }

    if (build.status !== 'completed') {
      return res.status(400).json({ success: false, message: 'Build is not completed yet' });
    }

    if (!build.output.apkPath) {
      return res.status(404).json({ success: false, message: 'APK file path not found' });
    }

    // Check if file exists
    if (!fs.existsSync(build.output.apkPath)) {
      logger.error(`APK file not found: ${build.output.apkPath}`);
      return res.status(404).json({ success: false, message: 'APK file not found on server' });
    }

    logger.info(`Downloading APK: ${buildId} - ${build.appConfig.appName}`);

    // Set headers
    const fileName = `${build.appConfig.appName.replace(/[^a-z0-9]/gi, '_')}.apk`;
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    // Stream the file
    const fileStream = fs.createReadStream(build.output.apkPath);
    fileStream.pipe(res);

    fileStream.on('error', (error) => {
      logger.error(`File stream error: ${error.message}`);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Error streaming file' });
      }
    });

  } catch (error) {
    logger.error(`Download error: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Worker health check server listening on port ${PORT}`);
});

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
