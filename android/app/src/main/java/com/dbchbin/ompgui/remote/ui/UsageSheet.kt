package com.dbchbin.ompgui.remote.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.Locale
import org.json.JSONObject

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UsageSheet(
    requester: com.dbchbin.ompgui.remote.relay.RelayRequester,
    onDismiss: () -> Unit,
    usageData: JSONObject? = null,
) {
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf(usageData) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val refresh: (Boolean) -> Unit = { force ->
        scope.launch {
            busy = true; error = null
            try { data = requester.request("system", "usage.get", JSONObject().put("refresh", force))
            } catch (failure: kotlinx.coroutines.CancellationException) { throw failure
            } catch (failure: Exception) { error = failure.message ?: "Usage request failed"
            } finally { busy = false }
        }
    }
    androidx.compose.runtime.LaunchedEffect(requester) { refresh(false) }
    val korean = Locale.getDefault().language == "ko"
    val reports = remember(data) { parseUsageReports(data) }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = OmpColors.BgPanel, contentColor = OmpColors.Text) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp).padding(bottom = 24.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(if (korean) "사용량" else "Usage", fontSize = 17.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                TextButton(enabled = !busy, onClick = { refresh(true) }) { Text(if (korean) "새로고침" else "Refresh") }
            }
            if (busy) CircularProgressIndicator()
            error?.let { Text(it, color = OmpColors.StatusError) }
            if (!busy && data != null && reports.isNullOrEmpty()) Text(data?.optString("emptyReason")?.ifBlank { "No usage limits available" } ?: "No usage limits available")
            for (report in reports.orEmpty()) {
                Text(report.provider, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp))
                for (limit in report.limits) UsageLimitRow(limit, korean)
            }
            data?.let { payload ->
                Text("Generated: ${payload.opt("generatedAt")} · Cached: ${payload.optBoolean("cached")}", modifier = Modifier.padding(top = 12.dp))
                // Keep provider-specific amounts, scopes, credentials and capacity visible;
                // their schema differs by provider and must not be reduced to percentages.
                for (key in listOf("reports", "accountsWithoutUsage", "disabledCredentials", "capacity")) {
                    if (payload.has(key) && !payload.isNull(key)) {
                        Text(key, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 12.dp))
                        androidx.compose.foundation.text.selection.SelectionContainer {
                            Text(when (val value = payload.opt(key)) {
                                is JSONObject -> value.toString(2)
                                is org.json.JSONArray -> value.toString(2)
                                else -> value.toString()
                            }, fontSize = 12.sp)
                        }
                    }
                }
            }
        }
    }
}

private data class UsageLimitView(
    val windowLabel: String,
    val usedFraction: Double,
    val resetsAtMs: Long?,
)

private data class UsageReportView(
    val provider: String,
    val limits: List<UsageLimitView>,
)

private fun parseUsageReports(root: JSONObject?): List<UsageReportView>? {
    if (root == null) return null
    val reports = root.optJSONArray("reports") ?: return null
    val out = mutableListOf<UsageReportView>()
    for (i in 0 until reports.length()) {
        val report = reports.optJSONObject(i) ?: continue
        val provider = report.optString("provider")
        if (provider.isBlank()) continue
        val limits = report.optJSONArray("limits") ?: continue
        val views = mutableListOf<UsageLimitView>()
        for (j in 0 until limits.length()) {
            val limit = limits.optJSONObject(j) ?: continue
            val fraction = resolveLimitFraction(limit) ?: continue
            val window = limit.optJSONObject("window")
            val scope = limit.optJSONObject("scope")
            val windowLabel = window?.optString("label")?.takeIf { it.isNotBlank() }
                ?: scope?.optString("windowId")?.takeIf { it.isNotBlank() }
                ?: limit.optString("label").ifBlank { continue }
            val resetsAt = window?.optLong("resetsAt")?.takeIf { it > 0 }
            views.add(
                UsageLimitView(
                    windowLabel = windowLabel,
                    usedFraction = fraction.coerceIn(0.0, 1.0),
                    resetsAtMs = resetsAt,
                ),
            )
        }
        if (views.isNotEmpty()) {
            out.add(UsageReportView(provider = provider, limits = views))
        }
    }
    return out
}

internal fun primaryUsageFraction(root: JSONObject?): Double? {
    val reports = parseUsageReports(root) ?: return null
    return reports
        .flatMap { it.limits }
        .maxByOrNull { it.usedFraction }
        ?.usedFraction
}

private fun resolveLimitFraction(limit: JSONObject): Double? {
    val amount = limit.optJSONObject("amount") ?: return null
    if (!amount.isNull("usedFraction")) {
        return amount.optDouble("usedFraction")
    }
    val used = if (!amount.isNull("used")) amount.optDouble("used") else Double.NaN
    val cap = if (!amount.isNull("limit")) amount.optDouble("limit") else Double.NaN
    if (!used.isNaN() && !cap.isNaN() && cap > 0) return used / cap
    if (amount.optString("unit") == "percent" && !used.isNaN()) return used / 100.0
    if (!amount.isNull("remainingFraction")) {
        return 1.0 - amount.optDouble("remainingFraction")
    }
    return null
}

@Composable
private fun UsageLimitRow(limit: UsageLimitView, korean: Boolean) {
    val fraction = limit.usedFraction
    val barColor = when {
        fraction > 0.9 -> OmpColors.StatusError
        fraction >= 0.7 -> OmpColors.StatusWarning
        else -> OmpColors.StatusSuccess
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
    ) {
        Text(
            text = windowLabelKo(limit.windowLabel, korean),
            fontSize = 13.sp,
            color = OmpColors.Text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(modifier = Modifier.height(6.dp))
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(6.dp)
                .clip(RoundedCornerShape(3.dp))
                .background(OmpColors.BgHover),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(fraction.toFloat().coerceIn(0f, 1f))
                    .height(6.dp)
                    .clip(RoundedCornerShape(3.dp))
                    .background(barColor),
            )
        }
        Spacer(modifier = Modifier.height(4.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = String.format(Locale.US, "%.1f%% ", fraction * 100.0) +
                    if (korean) "사용됨" else "used",
                fontSize = 12.sp,
                color = OmpColors.TextMuted,
                modifier = Modifier.weight(1f),
            )
            Spacer(modifier = Modifier.width(8.dp))
            limit.resetsAtMs?.let { resetsAt ->
                Text(
                    text = relativeResetLabel(resetsAt, korean),
                    fontSize = 12.sp,
                    color = OmpColors.TextDim,
                    maxLines = 1,
                )
            }
        }
    }
}

private fun windowLabelKo(raw: String, korean: Boolean): String {
    if (!korean) return raw
    return when (raw.trim().lowercase(Locale.US)) {
        "5h", "5시간", "5 hour", "5 hours" -> "5시간 윈도우"
        "7d", "7일", "weekly", "week" -> "주간 윈도우"
        "monthly", "month", "30d" -> "월간 윈도우"
        else -> raw
    }
}

private fun relativeResetLabel(resetsAt: Long, korean: Boolean): String {
    val remainingMs = maxOf(0L, resetsAt - System.currentTimeMillis())
    val minutes = remainingMs / 60_000L
    if (!korean) {
        if (minutes < 1) return "resetting soon"
        if (minutes < 60) return "resets in ${minutes}m"
        val hours = minutes / 60
        if (hours < 24) return "resets in ${hours}h"
        return "resets in ${hours / 24}d"
    }
    if (minutes < 1) return "곧 초기화"
    if (minutes < 60) return "${minutes}분 후 초기화"
    val hours = minutes / 60
    if (hours < 24) return "${hours}시간 후 초기화"
    return "${hours / 24}일 후 초기화"
}
