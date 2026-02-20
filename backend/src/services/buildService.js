const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const sharp = require('sharp');
const archiver = require('archiver');
const logger = require('../utils/logger');

const ANDROID_TEMPLATE_DIR = path.join(__dirname, '../../android-template');
const BUILD_OUTPUT_DIR = process.env.BUILD_OUTPUT_DIR || path.join(__dirname, '../../builds');
const TEMP_DIR = process.env.TEMP_DIR || path.join(__dirname, '../../temp');

/**
 * Main function to build APK
 */
async function buildAPK({ buildId, appConfig, features, isPremium, updateProgress }) {
  const projectDir = path.join(TEMP_DIR, buildId);
  
  try {
    // Step 1: Create project directory
    await updateProgress(15, 'Creating project structure...');
    await fs.mkdir(projectDir, { recursive: true });

    // Step 2: Copy Android template
    await updateProgress(20, 'Copying Android template...');
    await copyDirectory(ANDROID_TEMPLATE_DIR, projectDir);

    // Step 3: Update AndroidManifest.xml
    await updateProgress(30, 'Configuring app manifest...');
    await updateAndroidManifest(projectDir, appConfig, features);

    // Step 4: Update build.gradle
    await updateProgress(40, 'Configuring build scripts...');
    await updateBuildGradle(projectDir, appConfig);

    // Step 5: Update strings.xml
    await updateProgress(45, 'Setting app name...');
    await updateStringsXml(projectDir, appConfig);

    // Step 6: Process and copy app icon
    await updateProgress(50, 'Processing app icon...');
    await processAppIcon(projectDir, appConfig.appIcon);

    // Step 7: Process splash screen
    await updateProgress(55, 'Creating splash screen...');
    await processSplashScreen(projectDir, appConfig);

    // Step 8: Update MainActivity.kt
    await updateProgress(60, 'Configuring WebView...');
    await updateMainActivity(projectDir, appConfig, features, isPremium);

    // Step 9: Build APK with Gradle
    await updateProgress(70, 'Building APK (this may take a few minutes)...');
    const apkPath = await buildWithGradle(projectDir, buildId);

    // Step 10: Sign APK
    await updateProgress(90, 'Signing APK...');
    const signedApkPath = await signAPK(apkPath, buildId);

    // Step 11: Move to output directory
    await updateProgress(95, 'Finalizing...');
    const finalApkPath = path.join(BUILD_OUTPUT_DIR, `${buildId}.apk`);
    await fs.mkdir(BUILD_OUTPUT_DIR, { recursive: true });
    await fs.copyFile(signedApkPath, finalApkPath);

    // Get APK size
    const stats = await fs.stat(finalApkPath);
    const apkSize = stats.size;

    // Cleanup temp directory
    await fs.rm(projectDir, { recursive: true, force: true });

    // Generate download URL
    const downloadUrl = `/downloads/${buildId}.apk`;

    return {
      apkPath: finalApkPath,
      apkSize,
      downloadUrl
    };

  } catch (error) {
    // Cleanup on error
    try {
      await fs.rm(projectDir, { recursive: true, force: true });
    } catch (cleanupError) {
      logger.error(`Cleanup error: ${cleanupError.message}`);
    }
    throw error;
  }
}

/**
 * Copy directory recursively
 */
async function copyDirectory(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
      // Preserve file permissions (important for gradlew)
      const stats = await fs.stat(srcPath);
      await fs.chmod(destPath, stats.mode);
    }
  }
}

/**
 * Update AndroidManifest.xml
 */
async function updateAndroidManifest(projectDir, appConfig, features) {
  const manifestPath = path.join(projectDir, 'app/src/main/AndroidManifest.xml');
  let manifest = await fs.readFile(manifestPath, 'utf8');

  // Update package name
  manifest = manifest.replace(/package="[^"]*"/, `package="${appConfig.packageName}"`);

  // Add permissions based on features
  let permissions = `
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />`;

  if (features.fileUpload) {
    permissions += `
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />`;
  }

  if (features.geolocation) {
    permissions += `
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />`;
  }

  // Insert permissions before <application>
  manifest = manifest.replace('<application', permissions + '\n\n    <application');

  await fs.writeFile(manifestPath, manifest, 'utf8');
}

/**
 * Update build.gradle with package name and version
 */
async function updateBuildGradle(projectDir, appConfig) {
  const gradlePath = path.join(projectDir, 'app/build.gradle');
  let gradle = await fs.readFile(gradlePath, 'utf8');

  gradle = gradle.replace(/applicationId\s+"[^"]*"/, `applicationId "${appConfig.packageName}"`);
  gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${appConfig.versionCode || 1}`);
  gradle = gradle.replace(/versionName\s+"[^"]*"/, `versionName "${appConfig.versionName || '1.0.0'}"`);

  await fs.writeFile(gradlePath, gradle, 'utf8');
}

/**
 * Update strings.xml with app name
 */
async function updateStringsXml(projectDir, appConfig) {
  const stringsPath = path.join(projectDir, 'app/src/main/res/values/strings.xml');
  let strings = await fs.readFile(stringsPath, 'utf8');

  strings = strings.replace(
    /<string name="app_name">.*<\/string>/,
    `<string name="app_name">${escapeXml(appConfig.appName)}</string>`
  );

  await fs.writeFile(stringsPath, strings, 'utf8');
}

/**
 * Process and copy app icon
 */
async function processAppIcon(projectDir, iconPath) {
  if (!iconPath) {
    // Use default icon - already in template
    return;
  }

  const iconSizes = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192
  };

  for (const [folder, size] of Object.entries(iconSizes)) {
    const outputPath = path.join(projectDir, `app/src/main/res/${folder}/ic_launcher.png`);
    await sharp(iconPath)
      .resize(size, size)
      .png()
      .toFile(outputPath);
  }
}

/**
 * Process splash screen
 */
async function processSplashScreen(projectDir, appConfig) {
  const colorsPath = path.join(projectDir, 'app/src/main/res/values/colors.xml');
  let colors = await fs.readFile(colorsPath, 'utf8');

  // Update splash background color
  const splashColor = appConfig.splashBackground || '#FFFFFF';
  colors = colors.replace(
    /<color name="splash_background">.*<\/color>/,
    `<color name="splash_background">${splashColor}</color>`
  );

  await fs.writeFile(colorsPath, colors, 'utf8');

  // If splash image provided, process it
  if (appConfig.splashImage) {
    const splashPath = path.join(projectDir, 'app/src/main/res/drawable/splash_logo.png');
    await sharp(appConfig.splashImage)
      .resize(512, 512, { fit: 'inside' })
      .png()
      .toFile(splashPath);
  }
}

/**
 * Update MainActivity.kt with configuration
 */
async function updateMainActivity(projectDir, appConfig, features, isPremium) {
  const mainActivityPath = path.join(projectDir, 'app/src/main/kotlin/MainActivity.kt');
  let activity = await fs.readFile(mainActivityPath, 'utf8');

  // Update package name
  activity = activity.replace(/^package .+/, `package ${appConfig.packageName}`);

  // Update website URL
  activity = activity.replace(/WEBSITE_URL = ".*"/, `WEBSITE_URL = "${appConfig.websiteUrl}"`);

  // Update feature flags
  activity = activity.replace(/ENABLE_PULL_TO_REFRESH = \w+/, `ENABLE_PULL_TO_REFRESH = ${features.pullToRefresh}`);
  activity = activity.replace(/ENABLE_PROGRESS_BAR = \w+/, `ENABLE_PROGRESS_BAR = ${features.progressBar}`);
  activity = activity.replace(/ENABLE_ERROR_PAGE = \w+/, `ENABLE_ERROR_PAGE = ${features.errorPage}`);
  activity = activity.replace(/ENABLE_FILE_UPLOAD = \w+/, `ENABLE_FILE_UPLOAD = ${features.fileUpload}`);
  activity = activity.replace(/ENABLE_DEEP_LINKING = \w+/, `ENABLE_DEEP_LINKING = ${features.deepLinking}`);

  // Add/remove watermark for free users
  if (!isPremium) {
    const watermarkCode = `
        // Free version watermark
        webView.evaluateJavascript("""
            (function() {
                const watermark = document.createElement('div');
                watermark.innerHTML = 'Created with Web2APK';
                watermark.style.cssText = 'position:fixed;bottom:10px;right:10px;background:rgba(0,0,0,0.7);color:white;padding:5px 10px;border-radius:5px;font-size:12px;z-index:999999;';
                document.body.appendChild(watermark);
            })();
        """, null);
`;
    activity = activity.replace('// WATERMARK_PLACEHOLDER', watermarkCode);
  }

  await fs.writeFile(mainActivityPath, activity, 'utf8');
}

/**
 * Build APK with Gradle
 */
async function buildWithGradle(projectDir, buildId) {
  const gradlewPath = path.join(projectDir, 'gradlew');
  
  // Make gradlew executable
  await fs.chmod(gradlewPath, '755');

  const env = {
    ...process.env,
    ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT || '/opt/android-sdk',
    JAVA_HOME: process.env.JAVA_HOME || '/usr/lib/jvm/java-17-openjdk-amd64'
  };

  try {
    // Clean and build release APK
    execSync('./gradlew clean assembleRelease', {
      cwd: projectDir,
      env,
      stdio: 'pipe',
      timeout: 600000 // 10 minutes
    });

    const apkPath = path.join(projectDir, 'app/build/outputs/apk/release/app-release-unsigned.apk');
    
    // Check if APK was created
    try {
      await fs.access(apkPath);
      return apkPath;
    } catch (error) {
      throw new Error('APK file not found after build');
    }

  } catch (error) {
    logger.error(`Gradle build error: ${error.message}`);
    throw new Error(`Build failed: ${error.message}`);
  }
}

/**
 * Sign APK with keystore
 */
async function signAPK(unsignedApkPath, buildId) {
  const signedApkPath = path.join(TEMP_DIR, `${buildId}-signed.apk`);
  
  const keystorePath = process.env.KEYSTORE_PATH;
  const keystorePassword = process.env.KEYSTORE_PASSWORD;
  const keyAlias = process.env.KEY_ALIAS;
  const keyPassword = process.env.KEY_PASSWORD;

  if (!keystorePath || !keystorePassword || !keyAlias || !keyPassword) {
    logger.warn('Keystore not configured, using unsigned APK');
    return unsignedApkPath;
  }

  try {
    // Sign APK using apksigner
    execSync(
      `${process.env.ANDROID_SDK_ROOT}/build-tools/${process.env.ANDROID_BUILD_TOOLS_VERSION}/apksigner sign ` +
      `--ks ${keystorePath} ` +
      `--ks-pass pass:${keystorePassword} ` +
      `--ks-key-alias ${keyAlias} ` +
      `--key-pass pass:${keyPassword} ` +
      `--out ${signedApkPath} ` +
      unsignedApkPath,
      { stdio: 'pipe' }
    );

    return signedApkPath;
  } catch (error) {
    logger.error(`APK signing error: ${error.message}`);
    // Return unsigned APK if signing fails
    return unsignedApkPath;
  }
}

/**
 * Escape XML special characters
 */
function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = {
  buildAPK
};
