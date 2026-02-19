const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const redis = require('../config/redis');
const buildQueue = require('../config/queue');

/**
 * @desc    Health check endpoint
 * @route   GET /api/health
 * @access  Public
 */
router.get('/', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    services: {
      api: 'operational',
      database: 'unknown',
      redis: 'unknown',
      queue: 'unknown'
    }
  };

  // Check MongoDB
  try {
    if (mongoose.connection.readyState === 1) {
      health.services.database = 'operational';
    } else {
      health.services.database = 'down';
      health.status = 'degraded';
    }
  } catch (error) {
    health.services.database = 'down';
    health.status = 'degraded';
  }

  // Check Redis
  try {
    await redis.ping();
    health.services.redis = 'operational';
  } catch (error) {
    health.services.redis = 'down';
    health.status = 'degraded';
  }

  // Check Queue
  try {
    const queueHealth = await buildQueue.getJobCounts();
    health.services.queue = 'operational';
    health.queue = {
      waiting: queueHealth.waiting,
      active: queueHealth.active,
      completed: queueHealth.completed,
      failed: queueHealth.failed
    };
  } catch (error) {
    health.services.queue = 'down';
    health.status = 'degraded';
  }

  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

/**
 * @desc    Detailed system info (admin only in production)
 * @route   GET /api/health/info
 * @access  Public (should be protected in production)
 */
router.get('/info', (req, res) => {
  const info = {
    version: '1.0.0',
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    memory: {
      total: (process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2) + ' MB',
      used: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + ' MB'
    },
    cpu: process.cpuUsage()
  };

  res.json(info);
});

module.exports = router;
