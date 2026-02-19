const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const {
  createBuild,
  getBuildStatus,
  downloadAPK,
  getUserBuilds,
  deleteBuild,
  cancelBuild
} = require('../controllers/buildController');
const { protect } = require('../middleware/auth');
const { buildLimiter, downloadLimiter } = require('../middleware/rateLimiter');
const { buildValidation, buildIdValidation } = require('../middleware/validation');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PNG and JPG images are allowed.'), false);
  }
};

const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 // 5MB
  },
  fileFilter
});

// Routes
router.post(
  '/create',
  protect,
  buildLimiter,
  upload.fields([
    { name: 'appIcon', maxCount: 1 },
    { name: 'splashImage', maxCount: 1 }
  ]),
  buildValidation,
  createBuild
);

router.get('/', protect, getUserBuilds);
router.get('/:buildId', protect, buildIdValidation, getBuildStatus);
router.get('/:buildId/download', protect, downloadLimiter, buildIdValidation, downloadAPK);
router.delete('/:buildId', protect, buildIdValidation, deleteBuild);
router.post('/:buildId/cancel', protect, buildIdValidation, cancelBuild);

module.exports = router;
