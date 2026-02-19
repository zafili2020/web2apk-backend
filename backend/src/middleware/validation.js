const { body, param, validationResult } = require('express-validator');
const { AppError } = require('./errorHandler');

/**
 * Validation result checker
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(err => err.msg).join(', ');
    throw new AppError(errorMessages, 400);
  }
  next();
};

/**
 * Registration validation rules
 */
const registerValidation = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ min: 2, max: 50 }).withMessage('Name must be 2-50 characters'),
  
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email')
    .normalizeEmail(),
  
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase, one lowercase, and one number'),
  
  validate
];

/**
 * Login validation rules
 */
const loginValidation = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email')
    .normalizeEmail(),
  
  body('password')
    .notEmpty().withMessage('Password is required'),
  
  validate
];

/**
 * Build creation validation rules
 */
const buildValidation = [
  body('websiteUrl')
    .trim()
    .notEmpty().withMessage('Website URL is required')
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('Please provide a valid URL with http:// or https://'),
  
  body('appName')
    .trim()
    .notEmpty().withMessage('App name is required')
    .isLength({ min: 2, max: 50 }).withMessage('App name must be 2-50 characters')
    .matches(/^[a-zA-Z0-9\s\-_]+$/).withMessage('App name can only contain letters, numbers, spaces, hyphens, and underscores'),
  
  body('packageName')
    .optional()
    .trim()
    .matches(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/)
    .withMessage('Package name must be in format: com.example.app'),
  
  body('splashBackground')
    .optional()
    .trim()
    .matches(/^#[0-9A-Fa-f]{6}$/)
    .withMessage('Splash background must be a valid hex color (e.g., #FF5722)'),
  
  body('features.pullToRefresh')
    .optional()
    .isBoolean().withMessage('pullToRefresh must be a boolean'),
  
  body('features.progressBar')
    .optional()
    .isBoolean().withMessage('progressBar must be a boolean'),
  
  body('features.errorPage')
    .optional()
    .isBoolean().withMessage('errorPage must be a boolean'),
  
  body('features.fileUpload')
    .optional()
    .isBoolean().withMessage('fileUpload must be a boolean'),
  
  body('features.deepLinking')
    .optional()
    .isBoolean().withMessage('deepLinking must be a boolean'),
  
  validate
];

/**
 * Build ID param validation
 */
const buildIdValidation = [
  param('buildId')
    .trim()
    .notEmpty().withMessage('Build ID is required')
    .isUUID().withMessage('Invalid build ID format'),
  
  validate
];

/**
 * Email validation
 */
const emailValidation = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email')
    .normalizeEmail(),
  
  validate
];

/**
 * Password reset validation
 */
const resetPasswordValidation = [
  body('token')
    .trim()
    .notEmpty().withMessage('Reset token is required'),
  
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase, one lowercase, and one number'),
  
  validate
];

module.exports = {
  validate,
  registerValidation,
  loginValidation,
  buildValidation,
  buildIdValidation,
  emailValidation,
  resetPasswordValidation
};
