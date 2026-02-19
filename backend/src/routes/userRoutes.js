const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * @desc    Get user statistics
 * @route   GET /api/user/stats
 * @access  Private
 */
const getUserStats = asyncHandler(async (req, res) => {
  const Build = require('../models/Build');
  
  const totalBuilds = await Build.countDocuments({ 
    user: req.user._id,
    isDeleted: false
  });
  
  const completedBuilds = await Build.countDocuments({ 
    user: req.user._id,
    status: 'completed',
    isDeleted: false
  });
  
  const failedBuilds = await Build.countDocuments({ 
    user: req.user._id,
    status: 'failed',
    isDeleted: false
  });
  
  const activeBuilds = await Build.countDocuments({ 
    user: req.user._id,
    status: { $in: ['pending', 'queued', 'building'] },
    isDeleted: false
  });

  res.status(200).json({
    success: true,
    stats: {
      subscription: {
        plan: req.user.subscription.plan,
        status: req.user.subscription.status,
        currentPeriodEnd: req.user.subscription.currentPeriodEnd
      },
      usage: {
        buildsThisMonth: req.user.usage.buildsThisMonth,
        remainingBuilds: req.user.getRemainingBuilds(),
        totalBuilds: totalBuilds,
        completedBuilds,
        failedBuilds,
        activeBuilds
      },
      account: {
        createdAt: req.user.createdAt,
        lastLoginAt: req.user.lastLoginAt
      }
    }
  });
});

router.get('/stats', protect, getUserStats);

module.exports = router;
