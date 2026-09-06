package com.dbchbin.ompgui.remote.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dbchbin.ompgui.remote.R
import java.util.Locale
import kotlinx.coroutines.launch
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
    val usageRequestFailed = stringResource(R.string.usage_request_failed)
    val usageEmpty = stringResource(R.string.usage_empty)
    val usageAllProviders = stringResource(R.string.usage_all_providers)
    val refresh: (Boolean) -> Unit = { force ->
        scope.launch {
            busy = true; error = null
            try { data = requester.request("system", "usage.get", JSONObject().put("refresh", force))
            } catch (failure: kotlinx.coroutines.CancellationException) { throw failure
            } catch (failure: Exception) { error = failure.message ?: usageRequestFailed
            } finally { busy = false }
        }
    }
    LaunchedEffect(requester) { refresh(false) }
    val locale = Locale.getDefault()
    val numberFormat = remember(locale) { java.text.NumberFormat.getNumberInstance(locale).apply { maximumFractionDigits = 2 } }
    val reports = remember(data, locale) { parseUsageReports(data) }
    var providerFilter by rememberSaveable { mutableStateOf("") }
    var filterOpen by remember { mutableStateOf(false) }
    val providers = remember(reports) { reports.orEmpty().map { it.provider }.distinct().sorted() }
    val selectedProvider = providerFilter.takeIf { it in providers }.orEmpty()

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        dragHandle = { OmpSheetDragHandle() },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = OmpColors.Bg,
        contentColor = OmpColors.Text,
    ) {
        OmpDialogSystemBars()
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.94f)) {
            // Header
            Row(
                Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 16.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Gauge icon accent
                Box(
                    Modifier.size(20.dp).background(OmpColors.Accent.copy(alpha = 0.15f), RoundedCornerShape(4.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("■", color = OmpColors.Accent, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.width(10.dp))
                Text(
                    stringResource(R.string.usage_title),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                IconButton(enabled = !busy, onClick = { refresh(true) }, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Default.Refresh, stringResource(R.string.usage_refresh), modifier = Modifier.size(20.dp), tint = OmpColors.Accent)
                }
                IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Default.Close, stringResource(R.string.usage_close), modifier = Modifier.size(20.dp))
                }
            }
            HorizontalDivider(color = OmpColors.Border)
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())

            // Content
            Column(
                Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                // Error state
                error?.let {
                    Surface(
                        color = OmpColors.BgPanel,
                        shape = MaterialTheme.shapes.small,
                        border = BorderStroke(1.dp, OmpColors.StatusError.copy(alpha = 0.3f)),
                    ) {
                        Text(
                            it,
                            modifier = Modifier.padding(12.dp),
                            color = OmpColors.StatusError,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }

                // Loading / empty states
                if (busy && data == null) {
                    Column(
                        Modifier.fillMaxWidth().padding(vertical = 48.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text("■", color = OmpColors.Accent, fontSize = 24.sp)
                        Text(
                            stringResource(R.string.usage_loading),
                            color = OmpColors.TextDim,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
                if (!busy && data != null && reports.isNullOrEmpty()) {
                    Column(
                        Modifier.fillMaxWidth().padding(vertical = 48.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text("■", color = OmpColors.TextDim, fontSize = 24.sp)
                        Text(
                            data?.optString("emptyReason")?.ifBlank { usageEmpty } ?: usageEmpty,
                            color = OmpColors.TextMuted,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }

                // Provider filter
                if (providers.size > 1) {
                    OutlinedButton(
                        onClick = { filterOpen = true },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 40.dp),
                        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp),
                        shape = MaterialTheme.shapes.small,
                    ) {
                        Text(
                            selectedProvider.ifBlank { usageAllProviders },
                            Modifier.weight(1f),
                            color = OmpColors.Text,
                            style = MaterialTheme.typography.labelLarge,
                        )
                        Icon(Icons.Default.ExpandMore, stringResource(R.string.usage_filter_providers), modifier = Modifier.size(18.dp))
                    }
                    DropdownMenu(expanded = filterOpen, onDismissRequest = { filterOpen = false }) {
                        (listOf("") + providers).forEach { provider ->
                            DropdownMenuItem(
                                text = { Text(provider.ifBlank { usageAllProviders }) },
                                onClick = { providerFilter = provider; filterOpen = false },
                            )
                        }
                    }
                }

                // Provider cards
                val filteredReports = reports.orEmpty().filter { selectedProvider.isBlank() || it.provider == selectedProvider }
                val groupedByProvider = filteredReports.groupBy { it.provider }
                for ((provider, providerReports) in groupedByProvider) {
                    UsageProviderCard(
                        provider = provider,
                        reports = providerReports,
                        data = data,
                        numberFormat = numberFormat,
                    )
                }

                // Footer metadata
                data?.let { payload ->
                    val generatedAt = payload.optString("generatedAt", "")
                    val cached = payload.optBoolean("cached")
                    if (generatedAt.isNotBlank()) {
                        Text(
                            stringResource(
                                if (cached) R.string.usage_generated_cached else R.string.usage_generated_fresh,
                                generatedAt,
                            ),
                            style = MaterialTheme.typography.bodySmall,
                            color = OmpColors.TextDim,
                        )
                    }

                    // Disabled credentials section
                    val disabledCredentials = payload.optJSONArray("disabledCredentials")
                    if (disabledCredentials != null && disabledCredentials.length() > 0) {
                        UsageSectionCard(
                            title = stringResource(R.string.usage_disabled_credentials),
                            titleColor = OmpColors.StatusError,
                        ) {
                            for (index in 0 until disabledCredentials.length()) {
                                val entry = disabledCredentials.optJSONObject(index) ?: continue
                                UsageCredentialRow(
                                    name = listOf("email", "accountId", "orgName")
                                        .map { entry.optString(it) }
                                        .firstOrNull { it.isNotBlank() } ?: entry.optString("provider"),
                                    provider = entry.optString("provider"),
                                    cause = entry.optString("cause"),
                                    isError = true,
                                )
                            }
                        }
                    }

                    // Accounts without usage section
                    val accountsWithoutUsage = payload.optJSONArray("accountsWithoutUsage")
                    if (accountsWithoutUsage != null && accountsWithoutUsage.length() > 0) {
                        UsageSectionCard(
                            title = stringResource(R.string.usage_accounts_without_usage),
                            titleColor = OmpColors.TextMuted,
                        ) {
                            for (index in 0 until accountsWithoutUsage.length()) {
                                val entry = accountsWithoutUsage.optJSONObject(index) ?: continue
                                UsageCredentialRow(
                                    name = listOf("email", "accountId", "orgName")
                                        .map { entry.optString(it) }
                                        .firstOrNull { it.isNotBlank() } ?: entry.optString("provider"),
                                    provider = entry.optString("provider"),
                                    cause = entry.optString("cause"),
                                    isError = false,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

// ─── Data Models ───

private data class UsageLimitView(
    val windowLabel: String,
    val usedFraction: Double?,
    val resetsAtMs: Long?,
    val amountUsed: String?,
    val amountLimit: String?,
    val amountRemaining: String?,
    val unit: String?,
)

private data class UsageReportView(
    val provider: String,
    val limits: List<UsageLimitView>,
    val account: String,
)

// ─── Parsing ───

private fun formatUsageNumber(value: Any?, formatter: java.text.NumberFormat): String = when (value) {
    null, JSONObject.NULL -> "—"
    is Number -> if (value.toDouble().isFinite()) formatter.format(value) else "—"
    else -> value.toString()
}

private fun parseUsageReports(root: JSONObject?): List<UsageReportView>? {
    if (root == null) return null
    val numberFormat = java.text.NumberFormat.getNumberInstance(Locale.getDefault()).apply { maximumFractionDigits = 2 }
    val reportsJson = root.optJSONArray("reports") ?: return null
    val out = mutableListOf<UsageReportView>()
    for (i in 0 until reportsJson.length()) {
        val report = reportsJson.optJSONObject(i) ?: continue
        val provider = report.optString("provider")
        if (provider.isBlank()) continue
        val limitsJson = report.optJSONArray("limits") ?: continue
        val views = mutableListOf<UsageLimitView>()
        for (j in 0 until limitsJson.length()) {
            val limit = limitsJson.optJSONObject(j) ?: continue
            val fraction = resolveLimitFraction(limit)?.takeIf { it.isFinite() }
            val amount = limit.optJSONObject("amount")
            val window = limit.optJSONObject("window")
            val scope = limit.optJSONObject("scope")
            val windowLabel = window?.optString("label")?.takeIf { it.isNotBlank() }
                ?: scope?.optString("windowId")?.takeIf { it.isNotBlank() }
                ?: limit.optString("label").ifBlank { "Usage" }
            val resetsAt = window?.optLong("resetsAt")?.takeIf { it > 0 }
            views.add(
                UsageLimitView(
                    windowLabel = windowLabel,
                    usedFraction = fraction?.coerceIn(0.0, 1.0),
                    resetsAtMs = resetsAt,
                    amountUsed = amount?.opt("used")?.takeUnless { it == JSONObject.NULL }?.let { formatUsageNumber(it, numberFormat) },
                    amountLimit = amount?.opt("limit")?.takeUnless { it == JSONObject.NULL }?.let { formatUsageNumber(it, numberFormat) },
                    amountRemaining = amount?.opt("remaining")?.takeUnless { it == JSONObject.NULL }?.let { formatUsageNumber(it, numberFormat) },
                    unit = amount?.optString("unit")?.takeIf { it.isNotBlank() },
                ),
            )
        }
        if (views.isNotEmpty()) {
            val metadata = report.optJSONObject("metadata")
            val account = listOf("email", "accountId", "projectId")
                .mapNotNull { metadata?.optString(it)?.takeIf { name -> name.isNotBlank() } }
                .firstOrNull().orEmpty()
            val org = metadata?.optString("orgName").orEmpty()
            out.add(UsageReportView(
                provider = provider,
                limits = views,
                account = if (org.isNotBlank() && org != account) "$account ($org)" else account,
            ))
        }
    }
    return out
}

internal fun primaryUsageFraction(root: JSONObject?): Double? {
    val reports = parseUsageReports(root) ?: return null
    return reports
        .flatMap { it.limits }
        .mapNotNull { it.usedFraction }
        .maxOrNull()
}

private fun resolveLimitFraction(limit: JSONObject): Double? {
    val amount = limit.optJSONObject("amount") ?: return null
    if (!amount.isNull("usedFraction")) return amount.optDouble("usedFraction")
    val used = if (!amount.isNull("used")) amount.optDouble("used") else Double.NaN
    val cap = if (!amount.isNull("limit")) amount.optDouble("limit") else Double.NaN
    if (!used.isNaN() && !cap.isNaN() && cap > 0) return used / cap
    if (amount.optString("unit") == "percent" && !used.isNaN()) return used / 100.0
    if (!amount.isNull("remainingFraction")) return 1.0 - amount.optDouble("remainingFraction")
    return null
}

// ─── UI Components ───

@Composable
private fun UsageProviderCard(
    provider: String,
    reports: List<UsageReportView>,
    data: JSONObject?,
    numberFormat: java.text.NumberFormat,
) {
    Surface(
        color = OmpColors.BgPanel,
        shape = MaterialTheme.shapes.medium,
        border = BorderStroke(1.dp, OmpColors.Border),
    ) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            // Provider header with name and capacity chips
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    provider,
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.weight(1f),
                )
                // Capacity chips
                val capacity = data?.optJSONObject("capacity")?.optJSONArray(provider)
                if (capacity != null && capacity.length() > 0) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        for (index in 0 until capacity.length()) {
                            val stat = capacity.optJSONObject(index) ?: continue
                            val remaining = stat.opt("remainingAccounts")?.toString()?.toIntOrNull() ?: 0
                            val total = stat.opt("accounts")?.toString()?.toIntOrNull() ?: 0
                            val window = stat.optString("window")
                            val isExhausted = remaining <= 0 && total > 0
                            UsageCapacityChip(
                                label = window,
                                remaining = remaining,
                                total = total,
                                isExhausted = isExhausted,
                            )
                        }
                    }
                }
            }

            // Account blocks
            for ((index, report) in reports.withIndex()) {
                if (index > 0) {
                    HorizontalDivider(color = OmpColors.Border, modifier = Modifier.padding(horizontal = 0.dp))
                }
                UsageAccountBlock(
                    account = report.account,
                    limits = report.limits,
                )
            }
        }
    }
}

@Composable
private fun UsageAccountBlock(
    account: String,
    limits: List<UsageLimitView>,
) {
    Surface(
        color = OmpColors.Bg,
        shape = MaterialTheme.shapes.small,
        border = BorderStroke(1.dp, OmpColors.Border),
    ) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (account.isNotBlank()) {
                Text(
                    account,
                    style = MaterialTheme.typography.labelMedium,
                    color = OmpColors.Text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            for (limit in limits) {
                UsageLimitRow(limit)
            }
        }
    }
}

@Composable
private fun UsageLimitRow(limit: UsageLimitView) {
    val fraction = limit.usedFraction
    val barColor = when {
        fraction != null && fraction >= 1.0 -> OmpColors.StatusError
        fraction != null && fraction >= 0.9 -> OmpColors.StatusWarning
        else -> OmpColors.Accent
    }
    val percentText = if (fraction != null) {
        String.format(Locale.getDefault(), "%.1f%%", fraction * 100.0)
    } else null

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        // Label + percent inline
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = localizedWindowLabel(limit.windowLabel),
                fontSize = 13.sp,
                color = OmpColors.Text,
                modifier = Modifier.weight(1f),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (percentText != null) {
                Text(
                    text = stringResource(R.string.usage_percent_used, percentText),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = OmpColors.Text,
                    style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = "tnum"),
                )
            }
        }

        // Amounts line
        val amountParts = mutableListOf<String>()
        limit.amountUsed?.let { amountParts.add(it) }
        limit.amountLimit?.let { amountParts.add("/ $it") }
        limit.amountRemaining?.let { amountParts.add(stringResource(R.string.usage_amount_left, it)) }
        limit.unit?.let { amountParts.add(it) }
        if (amountParts.isNotEmpty()) {
            Text(
                text = amountParts.joinToString(" "),
                style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = "tnum"),
                color = OmpColors.TextMuted,
            )
        }

        // Progress bar
        if (fraction != null) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(8.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(OmpColors.BgHover),
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth(fraction.toFloat().coerceIn(0f, 1f))
                        .height(8.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(barColor),
                )
            }
        }

        // Reset time
        limit.resetsAtMs?.let { resetsAt ->
            Text(
                text = relativeResetLabel(resetsAt),
                fontSize = 11.sp,
                color = OmpColors.TextDim,
            )
        }
    }
}

@Composable
private fun UsageCapacityChip(
    label: String,
    remaining: Int,
    total: Int,
    isExhausted: Boolean,
) {
    val text = "$remaining/$total"
    val backgroundColor = if (isExhausted) {
        OmpColors.StatusError.copy(alpha = 0.12f)
    } else {
        OmpColors.Bg.copy(alpha = 0.5f)
    }
    val textColor = if (isExhausted) OmpColors.StatusError else OmpColors.TextMuted
    val borderColor = if (isExhausted) OmpColors.StatusError.copy(alpha = 0.4f) else OmpColors.Border

    Surface(
        color = backgroundColor,
        shape = MaterialTheme.shapes.extraSmall,
        border = BorderStroke(1.dp, borderColor),
    ) {
        Column(
            Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                label,
                fontSize = 10.sp,
                color = textColor,
                fontWeight = FontWeight.Medium,
            )
            Text(
                text,
                fontSize = 11.sp,
                color = textColor,
                fontWeight = FontWeight.SemiBold,
                style = MaterialTheme.typography.labelSmall.copy(fontFeatureSettings = "tnum"),
            )
        }
    }
}

@Composable
private fun UsageSectionCard(
    title: String,
    titleColor: Color,
    content: @Composable () -> Unit,
) {
    Surface(
        color = OmpColors.BgPanel,
        shape = MaterialTheme.shapes.small,
        border = BorderStroke(1.dp, OmpColors.Border),
    ) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                title,
                style = MaterialTheme.typography.titleSmall,
                color = titleColor,
            )
            content()
        }
    }
}

@Composable
private fun UsageCredentialRow(
    name: String,
    provider: String,
    cause: String?,
    isError: Boolean,
) {
    Column(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            name,
            style = MaterialTheme.typography.bodyMedium,
            color = OmpColors.Text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                provider,
                style = MaterialTheme.typography.bodySmall,
                color = OmpColors.TextMuted,
            )
            cause?.takeIf { it.isNotBlank() }?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (isError) OmpColors.StatusError else OmpColors.TextDim,
                )
            }
        }
    }
}

// ─── Localization Helpers ───

@Composable
private fun localizedWindowLabel(raw: String): String {
    return when (raw.trim().lowercase(Locale.US)) {
        "5h", "5시간", "5 hour", "5 hours" -> stringResource(R.string.usage_window_5h)
        "7d", "7일", "weekly", "week" -> stringResource(R.string.usage_window_weekly)
        "monthly", "month", "30d" -> stringResource(R.string.usage_window_monthly)
        else -> raw
    }
}

@Composable
private fun relativeResetLabel(resetsAt: Long): String {
    val remainingMs = maxOf(0L, resetsAt - System.currentTimeMillis())
    val minutes = remainingMs / 60_000L
    if (minutes < 1) return stringResource(R.string.usage_reset_soon)
    if (minutes < 60) return stringResource(R.string.usage_reset_minutes, minutes.toInt())
    val hours = minutes / 60
    if (hours < 24) return stringResource(R.string.usage_reset_hours, hours.toInt())
    return stringResource(R.string.usage_reset_days, (hours / 24).toInt())
}
