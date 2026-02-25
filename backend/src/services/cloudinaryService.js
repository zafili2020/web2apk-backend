const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const logger = require('../utils/logger');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Upload APK to Cloudinary
 * @param {string} localPath - Local file path
 * @param {string} buildId - Build ID for naming
 * @returns {Promise<{url: string, publicId: string, size: number}>}
 */
async function uploadAPK(localPath, buildId) {
  try {
    logger.info(`Uploading APK to Cloudinary: ${buildId}`);

    const result = await cloudinary.uploader.upload(localPath, {
      resource_type: 'raw',
      public_id: `apks/${buildId}`,
      folder: 'web2apk-builds',
      type: 'upload',
      access_mode: 'public'
    });

    logger.info(`APK uploaded successfully: ${result.secure_url}`);
    logger.info(`Cloudinary Public ID: ${result.public_id}`);
    logger.info(`File size: ${(result.bytes / (1024 * 1024)).toFixed(2)} MB`);

    return {
      url: result.secure_url,
      publicId: result.public_id,
      size: result.bytes
    };
  } catch (error) {
    logger.error(`Cloudinary upload failed: ${error.message}`);
    throw new Error(`Failed to upload APK to cloud storage: ${error.message}`);
  }
}

/**
 * Get download URL for APK
 * @param {string} publicId - Cloudinary public ID (e.g., 'web2apk-builds/apks/buildId')
 * @returns {string} - Direct download URL
 */
function getDownloadURL(publicId) {
  // Generate URL with attachment flag to force download
  const url = cloudinary.url(publicId, {
    resource_type: 'raw',
    secure: true,
    flags: 'attachment',
    sign_url: false
  });

  logger.info(`Generated download URL for: ${publicId}`);
  return url;
}

/**
 * Delete APK from Cloudinary
 * @param {string} publicId - Cloudinary public ID
 * @returns {Promise<void>}
 */
async function deleteAPK(publicId) {
  try {
    logger.info(`Deleting APK from Cloudinary: ${publicId}`);

    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'raw'
    });

    if (result.result === 'ok') {
      logger.info(`APK deleted successfully: ${publicId}`);
    } else {
      logger.warn(`APK deletion returned: ${result.result}`);
    }
  } catch (error) {
    logger.error(`Failed to delete APK: ${error.message}`);
    // Don't throw - deletion failures shouldn't break the flow
  }
}

/**
 * Check if Cloudinary is configured
 * @returns {boolean}
 */
function isConfigured() {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

module.exports = {
  uploadAPK,
  getDownloadURL,
  deleteAPK,
  isConfigured
};
