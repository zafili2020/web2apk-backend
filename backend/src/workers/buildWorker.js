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

// Debug endpoint to check file storage
app.get('/debug/files', async (req, res) => {
  try {
    const buildsDir = process.env.BUILD_OUTPUT_DIR || '/app/builds';
    
    // Check if directory exists
    if (!fs.existsSync(buildsDir)) {
      return res.json({
        exists: false,
        message: 'Builds directory does not exist',
        checkedPath: buildsDir
      });
    }

    // List all files in builds directory
    const files = fs.readdirSync(buildsDir);
    const fileDetails = [];

    for (const file of files) {
      const filePath = path.join(buildsDir, file);
      const stats = fs.statSync(filePath);
      
      if (stats.isDirectory()) {
        // List APK files in build subdirectories
        try {
          const subFiles = fs.readdirSync(filePath);
          for (const subFile of subFiles) {
            if (subFile.endsWith('.apk')) {
              const apkPath = path.join(filePath, subFile);
              const apkStats = fs.statSync(apkPath);
              fileDetails.push({
                buildId: file,
                fileName: subFile,
                fullPath: apkPath,
                sizeMB: (apkStats.size / (1024 * 1024)).toFixed(2),
                sizeBytes: apkStats.size,
                created: apkStats.birthtime,
                modified: apkStats.mtime
              });
            }
          }
        } catch (err) {
          // Skip if can't read subdirectory
        }
      }
    }

    res.json({
      success: true,
      exists: true,
      location: buildsDir,
      totalBuildDirs: files.length,
      totalAPKs: fileDetails.length,
      apkFiles: fileDetails,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
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
      result.downloadUrl,
      result.cloudinaryPublicId
    );

    logger.info(`Build completed: ${buildId}`);
    logger.info(`APK Path: ${result.apkPath}`);
    logger.info(`APK Size: ${(result.apkSize / (1024 * 1024)).toFixed(2)} MB`);
    logger.info(`Download URL: ${result.downloadUrl}`);
    if (result.cloudinaryPublicId) {
      logger.info(`Cloudinary Public ID: ${result.cloudinaryPublicId}`);
    }
    logger.info(`Database updated successfully for build: ${buildId}`);

    // Return success - even if job stalls after this, data is already saved!
    try {
      return {
        success: true,
        buildId,
        apkPath: result.apkPath,
        apkSize: result.apkSize,
        downloadUrl: result.downloadUrl
      };
    } catch (returnError) {
      // Log but don't fail - data is already in database
      logger.warn(`Job return error (data already saved): ${returnError.message}`);
      return { success: true, buildId };
    }

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
