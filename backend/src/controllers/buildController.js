const { v4: uuidv4 } = require('uuid');
const Build = require('../models/Build');
const buildQueue = require('../config/queue');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs').promises;

/**
 * @desc    Create new build
 * @route   POST /api/builds/create
 * @access  Private
 */
const createBuild = asyncHandler(async (req, res, next) => {
  const {
    websiteUrl,
    appName,
    packageName,
    splashBackground,
    features
  } = req.body;

  // Check if user can build
  if (!req.user.canBuild()) {
    const remainingBuilds = req.user.getRemainingBuilds();
    return next(new AppError(
      `Build limit reached. You have ${remainingBuilds} builds remaining this month. ${
        req.user.subscription.plan === 'free' ? 'Upgrade to Pro for unlimited builds.' : ''
      }`,
      403
    ));
  }

  // Check if Android SDK is available
  const sdkRoot = process.env.ANDROID_SDK_ROOT;
  if (!sdkRoot) {
    return next(new AppError(
      'Android SDK is not configured on this server. APK building is not available yet. Please contact support or deploy with Android SDK enabled.',
      503
    ));
  }

  // Auto-generate package name if not provided
  const finalPackageName = packageName || `com.web2apk.${appName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

  // Validate package name format
  const packageNameRegex = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
  if (!packageNameRegex.test(finalPackageName)) {
    return next(new AppError('Invalid package name format. Use format: com.example.app', 400));
  }

  // Generate unique build ID
  const buildId = uuidv4();

  // Ensure upload directories exist
  const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
  const buildOutputDir = process.env.BUILD_OUTPUT_DIR || path.join(__dirname, '../../builds');
  
  try {
    await fs.mkdir(uploadDir, { recursive: true });
    await fs.mkdir(buildOutputDir, { recursive: true });
  } catch (error) {
    logger.error(`Failed to create directories: ${error.message}`);
  }

  // Handle file uploads
  let appIconPath = null;
  let splashImagePath = null;

  if (req.files) {
    if (req.files.appIcon) {
      appIconPath = req.files.appIcon[0].path;
    }
    if (req.files.splashImage) {
      splashImagePath = req.files.splashImage[0].path;
    }
  }

  // Create build record
  const build = await Build.create({
    user: req.user._id,
    buildId,
    appConfig: {
      websiteUrl,
      appName,
      packageName: finalPackageName,
      splashBackground: splashBackground || '#FFFFFF',
      splashImage: splashImagePath,
      appIcon: appIconPath
    },
    features: {
      pullToRefresh: features?.pullToRefresh ?? true,
      progressBar: features?.progressBar ?? true,
      errorPage: features?.errorPage ?? true,
      fileUpload: features?.fileUpload ?? false,
      deepLinking: features?.deepLinking ?? false,
      swipeRefresh: features?.swipeRefresh ?? true,
      geolocation: features?.geolocation ?? false,
      localStorage: features?.localStorage ?? true
    },
    status: 'queued',
    isPremium: req.user.subscription.plan === 'pro',
    hasWatermark: req.user.subscription.plan !== 'pro'
  });

  // Add job to build queue
  const job = await buildQueue.add({
    buildId,
    userId: req.user._id.toString(),
    appConfig: build.appConfig,
    features: build.features,
    isPremium: build.isPremium
  }, {
    jobId: buildId,
    priority: build.isPremium ? 1 : 10 // Premium users get higher priority
  });

  // Update build with job info
  build.jobId = job.id.toString();
  build.buildTime.startedAt = new Date();
  await build.save();

  // Increment user build count
  await req.user.incrementBuildCount();

  logger.info(`Build created: ${buildId} for user: ${req.user.email}`);

  res.status(201).json({
    success: true,
    message: 'Build queued successfully',
    build: {
      id: build._id,
      buildId: build.buildId,
      status: build.status,
      appName: build.appConfig.appName,
      packageName: build.appConfig.packageName,
      progress: build.progress,
      currentStep: build.currentStep,
      createdAt: build.createdAt
    }
  });
});

/**
 * @desc    Get build status
 * @route   GET /api/builds/:buildId
 * @access  Private
 */
const getBuildStatus = asyncHandler(async (req, res, next) => {
  const { buildId } = req.params;

  const build = await Build.findOne({ buildId });

  if (!build) {
    return next(new AppError('Build not found', 404));
  }

  // Check if user owns this build
  if (build.user.toString() !== req.user._id.toString()) {
    return next(new AppError('Not authorized to access this build', 403));
  }

  res.status(200).json({
    success: true,
    build: {
      id: build._id,
      buildId: build.buildId,
      status: build.status,
      progress: build.progress,
      currentStep: build.currentStep,
      appName: build.appConfig.appName,
      packageName: build.appConfig.packageName,
      output: {
        downloadUrl: build.output.downloadUrl,
        apkPath: build.output.apkPath,
        apkSize: build.output.apkSize,
        cloudinaryPublicId: build.output.cloudinaryPublicId
      },
      downloadUrl: build.output.downloadUrl, // Keep for backwards compatibility
      apkSize: build.output.apkSize,
      apkSizeFormatted: build.apkSizeFormatted,
      duration: build.buildTime.duration,
      durationFormatted: build.durationFormatted,
      error: build.error.message,
      createdAt: build.createdAt,
      completedAt: build.buildTime.completedAt,
      expiresAt: build.expiresAt
    }
  });
});

/**
 * @desc    Download APK
 * @route   GET /api/builds/:buildId/download
 * @access  Private
 */
const downloadAPK = asyncHandler(async (req, res, next) => {
  const { buildId } = req.params;

  const build = await Build.findOne({ buildId });

  if (!build) {
    return next(new AppError('Build not found', 404));
  }

  // Check if user owns this build
  if (build.user.toString() !== req.user._id.toString()) {
    return next(new AppError('Not authorized to download this build', 403));
  }

  if (build.status !== 'completed') {
    return next(new AppError('Build is not completed yet', 400));
  }

  if (build.isExpired()) {
    return next(new AppError('Build has expired', 410));
  }

  // Increment download count
  await build.incrementDownloadCount();

  logger.info(`APK download requested: ${buildId} by user: ${req.user.email}`);

  // Check if we have a Cloudinary URL (starts with https://)
  if (build.output.apkPath && build.output.apkPath.startsWith('https://')) {
    // APK is on Cloudinary - redirect directly
    logger.info(`Redirecting to Cloudinary: ${build.output.apkPath}`);
    return res.redirect(build.output.apkPath);
  }

  // Fallback: Local file (for backwards compatibility or if Cloudinary fails)
  if (!build.output.apkPath) {
    return next(new AppError('APK file not found', 404));
  }

  // Check if local file exists
  try {
    await fs.access(build.output.apkPath);
  } catch (error) {
    return next(new AppError('APK file not found on server', 404));
  }

  logger.info(`Serving local APK: ${buildId}`);

  // Send local file
  res.download(build.output.apkPath, `${build.appConfig.appName}.apk`, (err) => {
    if (err) {
      logger.error(`Download error: ${err.message}`);
      if (!res.headersSent) {
        return next(new AppError('Error downloading file', 500));
      }
    }
  });
});

/**
 * @desc    Get user's builds
 * @route   GET /api/builds
 * @access  Private
 */
const getUserBuilds = asyncHandler(async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const builds = await Build.find({ 
    user: req.user._id,
    isDeleted: false
  })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .select('-error.stack -__v');

  const total = await Build.countDocuments({ 
    user: req.user._id,
    isDeleted: false
  });

  res.status(200).json({
    success: true,
    count: builds.length,
    total,
    pages: Math.ceil(total / limit),
    currentPage: page,
    builds: builds.map(build => ({
      id: build._id,
      buildId: build.buildId,
      appName: build.appConfig.appName,
      packageName: build.appConfig.packageName,
      websiteUrl: build.appConfig.websiteUrl,
      status: build.status,
      progress: build.progress,
      downloadUrl: build.output.downloadUrl,
      apkSizeFormatted: build.apkSizeFormatted,
      durationFormatted: build.durationFormatted,
      downloadCount: build.stats.downloadCount,
      createdAt: build.createdAt,
      completedAt: build.buildTime.completedAt,
      expiresAt: build.expiresAt,
      isExpired: build.isExpired()
    }))
  });
});

/**
 * @desc    Delete build
 * @route   DELETE /api/builds/:buildId
 * @access  Private
 */
const deleteBuild = asyncHandler(async (req, res, next) => {
  const { buildId } = req.params;

  const build = await Build.findOne({ buildId });

  if (!build) {
    return next(new AppError('Build not found', 404));
  }

  // Check if user owns this build
  if (build.user.toString() !== req.user._id.toString()) {
    return next(new AppError('Not authorized to delete this build', 403));
  }

  // Delete APK file if exists
  if (build.output.apkPath) {
    try {
      await fs.unlink(build.output.apkPath);
    } catch (error) {
      logger.warn(`Failed to delete APK file: ${error.message}`);
    }
  }

  // Delete uploaded files if exist
  if (build.appConfig.appIcon) {
    try {
      await fs.unlink(build.appConfig.appIcon);
    } catch (error) {
      logger.warn(`Failed to delete app icon: ${error.message}`);
    }
  }

  if (build.appConfig.splashImage) {
    try {
      await fs.unlink(build.appConfig.splashImage);
    } catch (error) {
      logger.warn(`Failed to delete splash image: ${error.message}`);
    }
  }

  // Mark as deleted instead of removing from DB
  build.isDeleted = true;
  await build.save();

  logger.info(`Build deleted: ${buildId} by user: ${req.user.email}`);

  res.status(200).json({
    success: true,
    message: 'Build deleted successfully'
  });
});

/**
 * @desc    Cancel build
 * @route   POST /api/builds/:buildId/cancel
 * @access  Private
 */
const cancelBuild = asyncHandler(async (req, res, next) => {
  const { buildId } = req.params;

  const build = await Build.findOne({ buildId });

  if (!build) {
    return next(new AppError('Build not found', 404));
  }

  // Check if user owns this build
  if (build.user.toString() !== req.user._id.toString()) {
    return next(new AppError('Not authorized to cancel this build', 403));
  }

  if (!['pending', 'queued', 'building'].includes(build.status)) {
    return next(new AppError('Build cannot be cancelled in current status', 400));
  }

  // Remove job from queue
  if (build.jobId) {
    try {
      const job = await buildQueue.getJob(build.jobId);
      if (job) {
        await job.remove();
      }
    } catch (error) {
      logger.warn(`Failed to remove job from queue: ${error.message}`);
    }
  }

  build.status = 'cancelled';
  build.currentStep = 'Build cancelled by user';
  await build.save();

  logger.info(`Build cancelled: ${buildId} by user: ${req.user.email}`);

  res.status(200).json({
    success: true,
    message: 'Build cancelled successfully'
  });
});

module.exports = {
  createBuild,
  getBuildStatus,
  downloadAPK,
  getUserBuilds,
  deleteBuild,
  cancelBuild
};
