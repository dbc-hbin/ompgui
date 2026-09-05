package com.dbchbin.ompgui.remote.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.rememberCoroutineScope
import com.dbchbin.ompgui.remote.relay.RelayRequester
import java.util.Locale
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.LocalContext
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Desktop import bound: 10 MB decoded session content. */
const val SESSION_IMPORT_MAX_BYTES = 10 * 1024 * 1024

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImportSessionSheet(
    requester: RelayRequester,
    onImported: (id: String, cwd: String) -> Unit,
    onDismiss: () -> Unit,
) {
    val korean = remember { Locale.getDefault().language == "ko" }
    val scope = rememberCoroutineScope()
    var fileName by remember { mutableStateOf("") }
    var content by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            pending = true
            error = null
            try {
                val loaded = withContext(Dispatchers.IO) {
                    val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                        if (it.moveToFirst()) it.getString(0) else null
                    } ?: "session.jsonl"
                    val bytes = context.contentResolver.openInputStream(uri)?.use { input ->
                        val output = java.io.ByteArrayOutputStream()
                        val buffer = ByteArray(8192)
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            require(output.size() + count <= SESSION_IMPORT_MAX_BYTES) { "File too large (max 10 MB)" }
                            output.write(buffer, 0, count)
                        }
                        output.toByteArray()
                    } ?: throw IllegalStateException("Unable to open document")
                    name to bytes.toString(Charsets.UTF_8)
                }
                fileName = loaded.first
                content = loaded.second
            } catch (e: Exception) { error = e.message ?: "Unable to read document" }
            finally { pending = false }
        }
    }
    val contentBytes = remember(content) { content.toByteArray(Charsets.UTF_8).size }
    val tooLarge = contentBytes > SESSION_IMPORT_MAX_BYTES
    val canConfirm = fileName.isNotBlank() && content.isNotBlank() && !tooLarge && !pending

    suspend fun doImport(name: String, body: String): Boolean {
        pending = true
        error = null
        return try {
            val result = requester.request(
                "sessions",
                "import",
                JSONObject().put("fileName", name).put("content", body),
            )
            onImported(result.optString("id"), result.optString("cwd"))
            true
        } catch (e: Exception) {
            error = e.message ?: "Import failed"
            false
        } finally {
            pending = false
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = OmpColors.BgPanel,
        contentColor = OmpColors.Text,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = if (korean) "세션 가져오기" else "Import session",
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = OmpColors.Text,
            )
            Text("Choose session file", color = OmpColors.Accent,
                modifier = Modifier.clickable(enabled = !pending) { picker.launch(arrayOf("*/*")) }.padding(vertical = 12.dp))
            Text(
                text = if (korean) "파일 이름" else "File name",
                fontSize = 12.sp,
                color = OmpColors.TextMuted,
                fontWeight = FontWeight.SemiBold,
            )
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp))
                    .padding(horizontal = 12.dp, vertical = 10.dp),
            ) {
                BasicTextField(
                    value = fileName,
                    onValueChange = { fileName = it },
                    singleLine = true,
                    textStyle = TextStyle(fontSize = 14.sp, color = OmpColors.Text),
                    cursorBrush = SolidColor(OmpColors.Accent),
                    modifier = Modifier.fillMaxWidth(),
                    decorationBox = { inner ->
                        if (fileName.isEmpty()) {
                            Text(
                                text = if (korean) "예: session.jsonl" else "e.g. session.jsonl",
                                color = OmpColors.TextDim,
                                fontSize = 14.sp,
                            )
                        }
                        inner()
                    },
                )
            }
            Text(
                text = if (korean) "내용 붙여넣기" else "Paste content",
                fontSize = 12.sp,
                color = OmpColors.TextMuted,
                fontWeight = FontWeight.SemiBold,
            )
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 160.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp))
                    .padding(12.dp),
            ) {
                BasicTextField(
                    value = content,
                    onValueChange = { content = it },
                    textStyle = TextStyle(fontSize = 13.sp, color = OmpColors.Text),
                    cursorBrush = SolidColor(OmpColors.Accent),
                    modifier = Modifier.fillMaxWidth(),
                    decorationBox = { inner ->
                        if (content.isEmpty()) {
                            Text(
                                text = if (korean) "내보낸 세션 내용을 붙여넣으세요" else "Paste exported session content",
                                color = OmpColors.TextDim,
                                fontSize = 13.sp,
                            )
                        }
                        inner()
                    },
                )
            }
            if (tooLarge) {
                Text(
                    text = if (korean) "파일이 너무 큽니다 (최대 10 MB)" else "File too large (max 10 MB)",
                    color = OmpColors.StatusError,
                    fontSize = 13.sp,
                )
            }
            error?.let {
                Text(text = it, color = OmpColors.StatusError, fontSize = 13.sp)
            }
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(44.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (canConfirm) OmpColors.AccentStrong else OmpColors.BgHover)
                    .clickable(enabled = canConfirm) {
                        val name = fileName.trim()
                        val body = content
                        scope.launch {
                            if (doImport(name, body)) onDismiss()
                        }
                    },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = if (pending) {
                        if (korean) "가져오는 중…" else "Importing…"
                    } else if (korean) "가져오기" else "Import",
                    color = if (canConfirm) androidx.compose.ui.graphics.Color.White else OmpColors.TextDim,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}
