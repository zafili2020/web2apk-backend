package com.web2apk.template

import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.view.View
import android.webkit.*
import android.widget.ProgressBar
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

class MainActivity : AppCompatActivity() {

    // Configuration - These will be replaced during build
    private val WEBSITE_URL = "https://example.com"
    private val ENABLE_PULL_TO_REFRESH = true
    private val ENABLE_PROGRESS_BAR = true
    private val ENABLE_ERROR_PAGE = true
    private val ENABLE_FILE_UPLOAD = false
    private val ENABLE_DEEP_LINKING = false

    private lateinit var webView: WebView
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var progressBar: ProgressBar

    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val results = if (result.resultCode == Activity.RESULT_OK) {
            WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        } else null
        fileUploadCallback?.onReceiveValue(results)
        fileUploadCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView      = findViewById(R.id.webView)
        swipeRefresh = findViewById(R.id.swipeRefresh)
        progressBar  = findViewById(R.id.progressBar)

        if (ENABLE_PULL_TO_REFRESH) {
            swipeRefresh.setOnRefreshListener { webView.reload() }
            swipeRefresh.setColorSchemeResources(
                android.R.color.holo_blue_bright,
                android.R.color.holo_green_light,
                android.R.color.holo_orange_light,
                android.R.color.holo_red_light
            )
        } else {
            swipeRefresh.isEnabled = false
        }

        if (!ENABLE_PROGRESS_BAR) progressBar.visibility = View.GONE

        configureWebView()

        val url = if (ENABLE_DEEP_LINKING && intent.data != null) {
            intent.data.toString()
        } else {
            WEBSITE_URL
        }
        webView.loadUrl(url)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        webView.settings.apply {
            javaScriptEnabled                  = true
            domStorageEnabled                  = true
            databaseEnabled                    = true
            setSupportZoom(true)
            builtInZoomControls                = false
            loadWithOverviewMode               = true
            useWideViewPort                    = true
            javaScriptCanOpenWindowsAutomatically = true
            mediaPlaybackRequiresUserGesture   = false
            allowFileAccess                    = true
            allowContentAccess                 = true
            setGeolocationEnabled(true)
            cacheMode                          = WebSettings.LOAD_DEFAULT
            mixedContentMode                   = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }

        webView.webViewClient = object : WebViewClient() {

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                if (url.startsWith("tel:") || url.startsWith("mailto:") ||
                    url.startsWith("sms:")  || url.startsWith("whatsapp:")
                ) {
                    return try {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                        true
                    } catch (e: Exception) {
                        false
                    }
                }
                return false
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                if (ENABLE_PROGRESS_BAR) progressBar.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (ENABLE_PROGRESS_BAR) progressBar.visibility = View.GONE
                swipeRefresh.isRefreshing = false
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (ENABLE_ERROR_PAGE && request?.isForMainFrame == true) showErrorPage()
            }
        }

        webView.webChromeClient = object : WebChromeClient() {

            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                super.onProgressChanged(view, newProgress)
                if (ENABLE_PROGRESS_BAR) {
                    progressBar.progress   = newProgress
                    progressBar.visibility = if (newProgress == 100) View.GONE else View.VISIBLE
                }
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                if (!ENABLE_FILE_UPLOAD) return false
                fileUploadCallback?.onReceiveValue(null)
                fileUploadCallback = filePathCallback
                val intent = fileChooserParams?.createIntent() ?: return false
                return try {
                    fileChooserLauncher.launch(intent)
                    true
                } catch (e: Exception) {
                    fileUploadCallback = null
                    false
                }
            }

            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?
            ) {
                callback?.invoke(origin, true, false)
            }

            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                consoleMessage?.let {
                    android.util.Log.d("WebView",
                        "${it.message()} -- From line ${it.lineNumber()} of ${it.sourceId()}")
                }
                return true
            }
        }

        webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            val filename = URLUtil.guessFileName(url, contentDisposition, mimeType)
            val request  = DownloadManager.Request(Uri.parse(url)).apply {
                setMimeType(mimeType)
                addRequestHeader("User-Agent", userAgent)
                setDescription("Downloading file...")
                setTitle(filename)
                allowScanningByMediaScanner()
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
            }
            val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            dm.enqueue(request)
        }
    }

    private fun showErrorPage() {
        val errorHtml = """
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        display: flex; justify-content: center; align-items: center;
                        height: 100vh; margin: 0;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white; text-align: center; padding: 20px; box-sizing: border-box;
                    }
                    .error-container { max-width: 400px; }
                    .wifi-icon { font-size: 64px; margin-bottom: 20px; }
                    h1 { font-size: 72px; margin: 0; font-weight: 700; }
                    h2 { font-size: 24px; margin: 20px 0; font-weight: 500; }
                    p  { font-size: 16px; opacity: 0.9; line-height: 1.6; }
                    button {
                        background: white; color: #667eea; border: none;
                        padding: 15px 30px; font-size: 16px; font-weight: 600;
                        border-radius: 25px; cursor: pointer; margin-top: 20px;
                        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                    }
                </style>
            </head>
            <body>
                <div class="error-container">
                    <div class="wifi-icon">📡</div>
                    <h1>Oops!</h1>
                    <h2>No Internet Connection</h2>
                    <p>Please check your internet connection and try again.</p>
                    <button onclick="location.reload()">Try Again</button>
                </div>
            </body>
            </html>
        """.trimIndent()
        webView.loadDataWithBaseURL(null, errorHtml, "text/html", "UTF-8", null)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        if (ENABLE_DEEP_LINKING && intent?.data != null) {
            webView.loadUrl(intent.data.toString())
        }
    }

    override fun onPause()   { super.onPause();   webView.onPause()   }
    override fun onResume()  { super.onResume();  webView.onResume()  }
    override fun onDestroy() { super.onDestroy(); webView.destroy()   }
}
