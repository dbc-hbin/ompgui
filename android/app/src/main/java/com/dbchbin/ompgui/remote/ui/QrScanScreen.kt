package com.dbchbin.ompgui.remote.ui

import android.annotation.SuppressLint
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.dbchbin.ompgui.remote.R
import com.dbchbin.ompgui.remote.relay.parsePairingUri
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * Full-screen CameraX QR scanner for `ompgui://pair` codes.
 *
 * Closes on the first [parsePairingUri] success; keeps scanning on invalid
 * codes and shows [R.string.pair_scan_invalid].
 */
@Composable
fun QrScanScreen(
    onScanned: (String) -> Unit,
    onClose: () -> Unit,
) {
    BackHandler(onBack = onClose)
    val context = LocalContext.current
    val view = androidx.compose.ui.platform.LocalView.current
    val window = remember(view, context) {
        // LocalContext can be the localized application context; the actual
        // Compose view retains the hosting Activity context chain.
        sequenceOf(view.context, context).mapNotNull { source ->
            generateSequence(source) { current ->
                (current as? android.content.ContextWrapper)?.baseContext?.takeIf { it !== current }
            }.filterIsInstance<android.app.Activity>().firstOrNull()
        }.firstOrNull()?.window
    }
    DisposableEffect(window, view) {
        val controller = window?.let { androidx.core.view.WindowCompat.getInsetsController(it, view) }
        val lightStatusBars = controller?.isAppearanceLightStatusBars
        val lightNavigationBars = controller?.isAppearanceLightNavigationBars
        controller?.isAppearanceLightStatusBars = false
        controller?.isAppearanceLightNavigationBars = false
        onDispose {
            if (controller != null) {
                controller.isAppearanceLightStatusBars = lightStatusBars == true
                controller.isAppearanceLightNavigationBars = lightNavigationBars == true
            }
        }
    }
    androidx.compose.runtime.SideEffect {
        window?.let {
            androidx.core.view.WindowCompat.getInsetsController(it, view).apply {
                isAppearanceLightStatusBars = false
                isAppearanceLightNavigationBars = false
            }
        }
    }
    val lifecycleOwner = LocalLifecycleOwner.current
    var invalidVisible by remember { mutableStateOf(false) }
    var cameraReady by remember { mutableStateOf(false) }
    var cameraError by remember { mutableStateOf<String?>(null) }
    val appContext = remember(context) { context.applicationContext }
    val completed = remember { AtomicBoolean(false) }
    val disposed = remember { AtomicBoolean(false) }
    val cameraProviderRef = remember { AtomicReference<ProcessCameraProvider?>(null) }

    val scannerOptions = remember {
        BarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .build()
    }
    val scanner = remember(scannerOptions) { BarcodeScanning.getClient(scannerOptions) }
    val analysisExecutor = remember { Executors.newSingleThreadExecutor() }
    val previewView = remember(context) {
        PreviewView(context).apply {
            scaleType = PreviewView.ScaleType.FILL_CENTER
        }
    }

    DisposableEffect(lifecycleOwner) {
        val providerFuture = ProcessCameraProvider.getInstance(appContext)
        val mainExecutor = ContextCompat.getMainExecutor(appContext)
        val listener = Runnable {
            if (disposed.get()) return@Runnable
            val provider = try {
                providerFuture.get()
            } catch (error: Exception) {
                cameraError = error.message ?: "Unable to open camera"
                return@Runnable
            }
            cameraProviderRef.set(provider)
            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(previewView.surfaceProvider)
            }
            val analysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
            analysis.setAnalyzer(analysisExecutor) { imageProxy ->
                if (disposed.get() || completed.get()) {
                    imageProxy.close()
                    return@setAnalyzer
                }
                @SuppressLint("UnsafeOptInUsageError")
                val mediaImage = imageProxy.image
                if (mediaImage == null) {
                    imageProxy.close()
                    return@setAnalyzer
                }
                val inputImage =
                    InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
                scanner.process(inputImage)
                    .addOnSuccessListener { barcodes ->
                        for (barcode in barcodes) {
                            val raw = barcode.rawValue ?: continue
                            if (parsePairingUri(raw) != null) {
                                if (completed.compareAndSet(false, true)) {
                                    previewView.post { onScanned(raw) }
                                }
                                return@addOnSuccessListener
                            } else {
                                previewView.post { invalidVisible = true }
                            }
                        }
                    }
                    .addOnFailureListener {
                        // Keep scanning; transient frame/scan failures are expected.
                    }
                    .addOnCompleteListener {
                        imageProxy.close()
                    }
            }
            if (disposed.get() || completed.get()) return@Runnable
            runCatching {
                provider.unbindAll()
                provider.bindToLifecycle(
                    lifecycleOwner,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    analysis,
                )
                cameraReady = true
            }.onFailure { error ->
                cameraError = error.message ?: "Unable to open camera"
            }
        }
        providerFuture.addListener(listener, mainExecutor)
        onDispose {
            disposed.set(true)
            runCatching { cameraProviderRef.getAndSet(null)?.unbindAll() }
            runCatching { scanner.close() }
            runCatching { analysisExecutor.shutdown() }
        }
    }

    Surface(modifier = Modifier.fillMaxSize()) {
        Box(modifier = Modifier.fillMaxSize()) {
            AndroidView(
                factory = { previewView },
                modifier = Modifier.fillMaxSize(),
            )
            Column(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .safeDrawingPadding()
                    .padding(16.dp)
                    .background(OmpColors.BgPanel, RoundedCornerShape(12.dp))
                    .border(1.dp, OmpColors.Border, RoundedCornerShape(12.dp))
                    .padding(horizontal = 12.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.pair_scan_qr), style = MaterialTheme.typography.titleMedium, color = OmpColors.Text, modifier = Modifier.weight(1f))
                    IconButton(onClick = onClose) { Icon(Icons.Filled.Close, stringResource(R.string.pair_scan_close), tint = OmpColors.Text) }
                }
                if (!cameraReady && cameraError == null) {
                    androidx.compose.material3.LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                }
                cameraError?.let { Text(it, color = OmpColors.StatusError, style = MaterialTheme.typography.bodyMedium) }
                if (invalidVisible) {
                    Text(
                        stringResource(R.string.pair_scan_invalid),
                        color = OmpColors.StatusError,
                    )
                }

            }
        }
    }
}
