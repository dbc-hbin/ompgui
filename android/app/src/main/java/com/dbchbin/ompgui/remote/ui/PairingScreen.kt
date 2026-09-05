package com.dbchbin.ompgui.remote.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.dbchbin.ompgui.remote.R

@Composable
fun PairingScreen(
    uri: String,
    password: String,
    error: String?,
    connecting: Boolean,
    onUriChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onConnect: () -> Unit,
) {
    val context = LocalContext.current
    var showScanner by remember { mutableStateOf(false) }
    var needCameraMessage by remember { mutableStateOf(false) }
    val cameraPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            needCameraMessage = false
            showScanner = true
        } else {
            needCameraMessage = true
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(OmpColors.Bg),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .safeDrawingPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .border(1.dp, OmpColors.Border, RoundedCornerShape(16.dp))
                    .background(OmpColors.BgPanel, RoundedCornerShape(16.dp))
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(
                    modifier = Modifier
                        .size(48.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(OmpColors.BgHover),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Filled.Terminal,
                        contentDescription = null,
                        tint = OmpColors.Accent,
                        modifier = Modifier.size(26.dp),
                    )
                }
                Text(
                    text = stringResource(R.string.pair_title),
                    fontWeight = FontWeight.Bold,
                    fontSize = 22.sp,
                    color = OmpColors.Text,
                )
                Text(
                    text = stringResource(R.string.pair_description),
                    fontSize = 13.sp,
                    lineHeight = 19.sp,
                    color = OmpColors.TextMuted,
                )
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    OmpField(
                        label = stringResource(R.string.pair_link_label),
                        value = uri,
                        onValueChange = onUriChange,
                        monospace = true,
                        minLines = 3,
                        singleLine = false,
                    )
                    OmpField(
                        label = stringResource(R.string.pair_password_label),
                        value = password,
                        onValueChange = onPasswordChange,
                        monospace = false,
                        minLines = 1,
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    )
                }
                if (!error.isNullOrBlank()) {
                    Text(
                        error,
                        color = OmpColors.StatusError,
                        fontSize = 13.sp,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (needCameraMessage) {
                    Text(
                        stringResource(R.string.pair_scan_need_camera),
                        color = OmpColors.StatusError,
                        fontSize = 13.sp,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                OmpButton(
                    outlined = true,
                    onClick = {
                        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                            PackageManager.PERMISSION_GRANTED
                        ) {
                            needCameraMessage = false
                            showScanner = true
                        } else {
                            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                        }
                    },
                    icon = {
                        Icon(
                            imageVector = Icons.Filled.QrCodeScanner,
                            contentDescription = null,
                            tint = OmpColors.Text,
                            modifier = Modifier.size(18.dp),
                        )
                    },
                    label = stringResource(R.string.pair_scan_qr),
                )
                OmpButton(
                    outlined = false,
                    enabled = uri.isNotBlank() && !connecting,
                    onClick = onConnect,
                    label = if (connecting) {
                        stringResource(R.string.pair_connecting)
                    } else {
                        stringResource(R.string.pair_connect)
                    },
                )
            }
        }
        if (showScanner) {
            QrScanScreen(
                onScanned = { raw ->
                    showScanner = false
                    onUriChange(raw)
                    onConnect()
                },
                onClose = { showScanner = false },
            )
        }
    }
}

@Composable
private fun OmpField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    monospace: Boolean,
    minLines: Int,
    singleLine: Boolean,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
) {
    var focused by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            text = label,
            fontSize = 12.sp,
            color = OmpColors.TextMuted,
        )
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .border(
                    1.dp,
                    if (focused) OmpColors.Accent else OmpColors.Border,
                    RoundedCornerShape(8.dp),
                )
                .background(OmpColors.CodeBg, RoundedCornerShape(8.dp))
                .onFocusChanged { focused = it.isFocused }
                .padding(horizontal = 12.dp, vertical = 10.dp),
        ) {
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = singleLine,
                minLines = minLines,
                visualTransformation = visualTransformation,
                keyboardOptions = keyboardOptions,
                textStyle = TextStyle(
                    color = OmpColors.Text,
                    fontSize = 13.sp,
                    fontFamily = if (monospace) FontFamily.Monospace else FontFamily.Default,
                ),
                cursorBrush = SolidColor(OmpColors.Text),
                modifier = Modifier.fillMaxWidth(),
                decorationBox = { inner ->
                    Box {
                        if (value.isEmpty()) {
                            Text(
                                text = label,
                                color = OmpColors.TextDim,
                                fontSize = 13.sp,
                                fontFamily = if (monospace) {
                                    FontFamily.Monospace
                                } else {
                                    FontFamily.Default
                                },
                            )
                        }
                        inner()
                    }
                },
            )
        }
    }
}

@Composable
private fun OmpButton(
    outlined: Boolean,
    label: String,
    onClick: () -> Unit,
    enabled: Boolean = true,
    icon: @Composable (() -> Unit)? = null,
) {
    val bg = when {
        outlined -> OmpColors.BgHover
        enabled -> OmpColors.AccentStrong
        else -> OmpColors.BgHover
    }
    val fg = if (outlined || !enabled) OmpColors.Text else Color.White
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(bg)
            .then(
                if (outlined) {
                    Modifier.border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp))
                } else {
                    Modifier
                },
            )
            .let { base ->
                if (enabled) {
                    base.clickable(onClick = onClick)
                } else {
                    base
                }
            }
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        icon?.invoke()
        if (icon != null) {
            Spacer(modifier = Modifier.width(8.dp))
        }
        Text(
            text = label,
            fontWeight = FontWeight.SemiBold,
            fontSize = 15.sp,
            color = fg,
        )
    }
}
