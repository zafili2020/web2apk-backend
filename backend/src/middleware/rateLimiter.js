const rateLimit = require('express-rate-limit');

/**
 * General API rate limiter
 * Using memory store (works without Redis initially)
 */
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: {
    success: false,
    message: 'Too many requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/api/health';
  }
});

/**
 * Strict rate limiter for authentication endpoints
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Build creation rate limiter
 */
const buildLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: async (req) => {
    // Allow more builds for pro users
    if (req.user && req.user.subscription.plan === 'pro') {
      return 20;
    }
    return 5;
  },
  keyGenerator: (req) => {
    return req.user ? req.user._id.toString() : req.ip;
  },
  message: {
    success: false,
    message: 'Build rate limit exceeded. Please wait before creating another build.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Download rate limiter
 */
const downloadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  message: {
    success: false,
    message: 'Too many downloads, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  apiLimiter,
  authLimiter,
  buildLimiter,
  downloadLimiter
};
