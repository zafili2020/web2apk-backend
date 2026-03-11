const { createBullBoard } = require('@bull-board/api');
const { BullAdapter } = require('@bull-board/api/bullAdapter');
const { ExpressAdapter } = require('@bull-board/express');
const buildQueue = require('../config/queue');

// Create Express adapter for Bull Board
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

// Create Bull Board with your build queue
createBullBoard({
  queues: [new BullAdapter(buildQueue)],
  serverAdapter: serverAdapter,
});

// Export the router
module.exports = serverAdapter.getRouter();
