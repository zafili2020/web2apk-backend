const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters'],
    maxlength: [50, 'Name cannot exceed 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false // Don't include password in queries by default
  },
  avatar: {
    type: String,
    default: null
  },
  subscription: {
    plan: {
      type: String,
      enum: ['free', 'pro'],
      default: 'free'
    },
    status: {
      type: String,
      enum: ['active', 'cancelled', 'expired', 'trialing'],
      default: 'active'
    },
    stripeCustomerId: {
      type: String,
      default: null
    },
    stripeSubscriptionId: {
      type: String,
      default: null
    },
    currentPeriodStart: {
      type: Date,
      default: null
    },
    currentPeriodEnd: {
      type: Date,
      default: null
    },
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false
    }
  },
  usage: {
    buildsThisMonth: {
      type: Number,
      default: 0
    },
    totalBuilds: {
      type: Number,
      default: 0
    },
    lastBuildDate: {
      type: Date,
      default: null
    },
    monthResetDate: {
      type: Date,
      default: () => new Date()
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  verificationToken: {
    type: String,
    default: null
  },
  resetPasswordToken: {
    type: String,
    default: null
  },
  resetPasswordExpire: {
    type: Date,
    default: null
  },
  lastLoginAt: {
    type: Date,
    default: null
  },
  lastLoginIp: {
    type: String,
    default: null
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
userSchema.index({ 'subscription.stripeCustomerId': 1 });
userSchema.index({ createdAt: -1 });

// Virtual for builds
userSchema.virtual('builds', {
  ref: 'Build',
  localField: '_id',
  foreignField: 'user'
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to check if user can build
userSchema.methods.canBuild = function() {
  const maxBuilds = this.subscription.plan === 'pro' 
    ? parseInt(process.env.MAX_PRO_BUILDS_PER_MONTH) || 999
    : parseInt(process.env.MAX_FREE_BUILDS_PER_MONTH) || 3;
  
  // Reset monthly counter if month has passed
  const now = new Date();
  const monthResetDate = new Date(this.usage.monthResetDate);
  
  if (now.getMonth() !== monthResetDate.getMonth() || 
      now.getFullYear() !== monthResetDate.getFullYear()) {
    this.usage.buildsThisMonth = 0;
    this.usage.monthResetDate = now;
  }
  
  return this.usage.buildsThisMonth < maxBuilds;
};

// Method to increment build count
userSchema.methods.incrementBuildCount = async function() {
  this.usage.buildsThisMonth += 1;
  this.usage.totalBuilds += 1;
  this.usage.lastBuildDate = new Date();
  await this.save();
};

// Method to get remaining builds
userSchema.methods.getRemainingBuilds = function() {
  const maxBuilds = this.subscription.plan === 'pro' 
    ? parseInt(process.env.MAX_PRO_BUILDS_PER_MONTH) || 999
    : parseInt(process.env.MAX_FREE_BUILDS_PER_MONTH) || 3;
  
  return Math.max(0, maxBuilds - this.usage.buildsThisMonth);
};

// Remove sensitive data when converting to JSON
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  delete user.verificationToken;
  delete user.resetPasswordToken;
  delete user.resetPasswordExpire;
  return user;
};

const User = mongoose.model('User', userSchema);

module.exports = User;
