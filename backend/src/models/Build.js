const mongoose = require('mongoose');

const buildSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  buildId: {
    type: String,
    required: true,
    unique: true
  },
  // App Configuration
  appConfig: {
    websiteUrl: {
      type: String,
      required: true,
      trim: true
    },
    appName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50
    },
    packageName: {
      type: String,
      required: true,
      trim: true,
      match: /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/
    },
    versionCode: {
      type: Number,
      default: 1
    },
    versionName: {
      type: String,
      default: '1.0.0'
    },
    splashBackground: {
      type: String,
      default: '#FFFFFF'
    },
    splashImage: {
      type: String,
      default: null
    },
    appIcon: {
      type: String,
      default: null
    }
  },
  // Feature Flags
  features: {
    pullToRefresh: {
      type: Boolean,
      default: true
    },
    progressBar: {
      type: Boolean,
      default: true
    },
    errorPage: {
      type: Boolean,
      default: true
    },
    fileUpload: {
      type: Boolean,
      default: false
    },
    deepLinking: {
      type: Boolean,
      default: false
    },
    swipeRefresh: {
      type: Boolean,
      default: true
    },
    geolocation: {
      type: Boolean,
      default: false
    },
    localStorage: {
      type: Boolean,
      default: true
    }
  },
  // Build Status
  status: {
    type: String,
    enum: ['pending', 'queued', 'building', 'completed', 'failed', 'cancelled'],
    default: 'pending',
    index: true
  },
  progress: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  currentStep: {
    type: String,
    default: 'Initializing...'
  },
  // Build Output
  output: {
    apkPath: {
      type: String,
      default: null
    },
    apkSize: {
      type: Number,
      default: null
    },
    downloadUrl: {
      type: String,
      default: null
    },
    qrCode: {
      type: String,
      default: null
    },
    cloudinaryPublicId: {
      type: String,
      default: null
    }
  },
  // Build Metadata
  buildTime: {
    startedAt: {
      type: Date,
      default: null
    },
    completedAt: {
      type: Date,
      default: null
    },
    duration: {
      type: Number, // in milliseconds
      default: null
    }
  },
  // Error Information
  error: {
    message: {
      type: String,
      default: null
    },
    stack: {
      type: String,
      default: null
    },
    code: {
      type: String,
      default: null
    }
  },
  // Queue Information
  queuePosition: {
    type: Number,
    default: null
  },
  jobId: {
    type: String,
    default: null
  },
  // Build Environment
  buildEnvironment: {
    androidSdkVersion: {
      type: String,
      default: null
    },
    gradleVersion: {
      type: String,
      default: null
    },
    buildToolsVersion: {
      type: String,
      default: null
    }
  },
  // Expiry & Retention
  expiresAt: {
    type: Date,
    default: null
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  // Statistics
  stats: {
    downloadCount: {
      type: Number,
      default: 0
    },
    lastDownloadAt: {
      type: Date,
      default: null
    }
  },
  // Premium Features
  isPremium: {
    type: Boolean,
    default: false
  },
  hasWatermark: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
buildSchema.index({ user: 1, createdAt: -1 });
buildSchema.index({ status: 1, createdAt: -1 });
buildSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index

// Virtual for build duration in human-readable format
buildSchema.virtual('durationFormatted').get(function() {
  if (!this.buildTime.duration) return null;
  const seconds = Math.floor(this.buildTime.duration / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0 
    ? `${minutes}m ${remainingSeconds}s` 
    : `${seconds}s`;
});

// Virtual for APK size in human-readable format
buildSchema.virtual('apkSizeFormatted').get(function() {
  if (!this.output.apkSize) return null;
  const mb = (this.output.apkSize / (1024 * 1024)).toFixed(2);
  return `${mb} MB`;
});

// Method to check if build is expired
buildSchema.methods.isExpired = function() {
  if (!this.expiresAt) return false;
  return new Date() > this.expiresAt;
};

// Method to increment download count
buildSchema.methods.incrementDownloadCount = async function() {
  this.stats.downloadCount += 1;
  this.stats.lastDownloadAt = new Date();
  await this.save();
};

// Method to update progress
buildSchema.methods.updateProgress = async function(progress, step) {
  this.progress = progress;
  this.currentStep = step;
  await this.save();
};

// Method to mark as completed
buildSchema.methods.markCompleted = async function(apkPath, apkSize, downloadUrl, cloudinaryPublicId = null) {
  this.status = 'completed';
  this.progress = 100;
  this.currentStep = 'Build completed successfully';
  this.output.apkPath = apkPath;
  this.output.apkSize = apkSize;
  this.output.downloadUrl = downloadUrl;
  this.output.cloudinaryPublicId = cloudinaryPublicId;
  this.buildTime.completedAt = new Date();
  this.buildTime.duration = this.buildTime.completedAt - this.buildTime.startedAt;
  
  // Set expiry based on subscription
  const retentionDays = this.isPremium 
    ? parseInt(process.env.APK_RETENTION_DAYS_PRO) || 365
    : parseInt(process.env.APK_RETENTION_DAYS_FREE) || 1;
  
  this.expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);
  
  await this.save();
};

// Method to mark as failed
buildSchema.methods.markFailed = async function(error) {
  this.status = 'failed';
  this.error.message = error.message || 'Build failed';
  this.error.stack = error.stack || null;
  this.error.code = error.code || 'BUILD_ERROR';
  this.buildTime.completedAt = new Date();
  this.buildTime.duration = this.buildTime.completedAt - this.buildTime.startedAt;
  await this.save();
};

// Static method to clean up expired builds
buildSchema.statics.cleanupExpired = async function() {
  const fs = require('fs').promises;
  const path = require('path');
  
  const expiredBuilds = await this.find({
    expiresAt: { $lt: new Date() },
    isDeleted: false
  });
  
  for (const build of expiredBuilds) {
    try {
      if (build.output.apkPath) {
        await fs.unlink(build.output.apkPath);
      }
      build.isDeleted = true;
      await build.save();
    } catch (error) {
      console.error(`Failed to cleanup build ${build.buildId}:`, error);
    }
  }
  
  return expiredBuilds.length;
};

const Build = mongoose.model('Build', buildSchema);

module.exports = Build;
