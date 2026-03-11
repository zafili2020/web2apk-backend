const express = require('express');
const { createBullBoard } = require('@bull-board/api');
const { BullAdapter } = require('@bull-board/api/bullAdapter');
const { ExpressAdapter } = require('@bull-board/express');
const buildQueue = require('../config/queue');

const router = express.Router();

// Basic Auth Middleware
const basicAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
    return res.status(401).json({ message: 'Authentication required' });
  }
  
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');
  
  // Check credentials
  const validUsername = process.env.BULL_BOARD_USERNAME || 'admin';
  const validPassword = process.env.BULL_BOARD_PASSWORD || 'change-this-password';
  
  if (username === validUsername && password === validPassword) {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
    return res.status(401).json({ message: 'Invalid credentials' });
  }
};

// Create Bull Board
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullAdapter(buildQueue)],
  serverAdapter: serverAdapter,
});

// Apply authentication
router.use(basicAuth);
router.use('/', serverAdapter.getRouter());

module.exports = router;