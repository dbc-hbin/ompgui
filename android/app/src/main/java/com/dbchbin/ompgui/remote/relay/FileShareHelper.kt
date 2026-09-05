package com.dbchbin.ompgui.remote.relay

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.util.UUID

suspend fun createCachedDownload(
    context: Context,
    fileName: String,
    readChunk: suspend (offset: Long) -> JSONObject,
): Uri = withContext(Dispatchers.IO) {
    val directory = File(context.cacheDir, "shared-files").apply { check(mkdirs() || isDirectory) }
    val safeName = fileName.substringAfterLast('/').substringAfterLast('\\')
        .replace(Regex("[^\\p{L}\\p{N}._ -]"), "_").take(160).ifBlank { "download" }
    val file = File(directory, "${UUID.randomUUID()}-$safeName")
    try {
        file.outputStream().buffered().use { output ->
            var offset = 0L
            do {
                val chunk = readChunk(offset)
                val encoded = chunk.getString("data")
                require(encoded.length <= 174_764) { "Download chunk exceeds 128 KiB" }
                val bytes = Base64.decode(encoded, Base64.NO_WRAP)
                val next = chunk.getLong("nextOffset")
                val complete = chunk.getBoolean("complete")
                require(bytes.size <= 131_072 && next == offset + bytes.size) { "Invalid download offset" }
                require(next <= 100L * 1024 * 1024) { "Download exceeds 100 MiB" }
                require(complete || next > offset) { "Download made no progress" }
                output.write(bytes)
                offset = next
            } while (!complete)
        }
        FileProvider.getUriForFile(context, context.packageName, file)
    } catch (error: Throwable) {
        file.delete()
        throw error
    }
}

fun shareFile(context: Context, uri: Uri, mime: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = mime
        putExtra(Intent.EXTRA_STREAM, uri)
        clipData = ClipData.newRawUri("Shared file", uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(send, "Share file").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

suspend fun uploadLocalFile(
    context: Context,
    requester: RelayRequester,
    uri: Uri,
    dir: String,
    conflict: String = "error",
): JSONObject = withContext(Dispatchers.IO) {
    var name = "upload"
    context.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
        if (it.moveToFirst()) name = it.getString(0) ?: name
    }
    val staging = File.createTempFile("upload-", ".tmp", context.cacheDir)
    var transfer: String? = null
    try {
        context.contentResolver.openInputStream(uri)?.use { input ->
            staging.outputStream().use { output ->
                val buffer = ByteArray(96 * 1024)
                var total = 0L
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    total += count
                    require(total <= 25L * 1024 * 1024) { "Upload exceeds 25 MiB" }
                    output.write(buffer, 0, count)
                }
            }
        } ?: error("Cannot read selected document")
        val begin = requester.request("files", "uploadBegin", JSONObject()
            .put("dir", dir).put("file", name).put("size", staging.length()).put("conflict", conflict))
        if (begin.optBoolean("skipped")) return@withContext begin
        val id = begin.getString("transferId")
        transfer = id
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        staging.inputStream().use { input ->
            val buffer = ByteArray(96 * 1024)
            var offset = 0L
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
                val result = requester.request("files", "uploadChunk", JSONObject().put("transferId", id)
                    .put("offset", offset).put("data", Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP)))
                offset += count
                require(result.getLong("received") == offset) { "Upload acknowledgement mismatch" }
            }
        }
        val hash = digest.digest().joinToString("") { "%02x".format(it) }
        requester.request("files", "uploadComplete", JSONObject().put("transferId", id).put("sha256", hash))
            .also { transfer = null }
    } finally {
        staging.delete()
        transfer?.let { id ->
            withContext(kotlinx.coroutines.NonCancellable) {
                runCatching { requester.request("files", "uploadAbort", JSONObject().put("transferId", id)) }
            }
        }
    }
}

fun openFilePreview(context: Context, uri: Uri, mime: String) {
    context.startActivity(Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, mime)
        clipData = ClipData.newRawUri("File preview", uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    })
}
