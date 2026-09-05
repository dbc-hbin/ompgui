package com.dbchbin.ompgui.remote.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.LinkOff
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dbchbin.ompgui.remote.R
import com.dbchbin.ompgui.remote.net.ConnectionState
import com.dbchbin.ompgui.remote.relay.ModelRef
import com.dbchbin.ompgui.remote.relay.RelayModelOption
import com.dbchbin.ompgui.remote.relay.SessionListItem
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private data class ProjectGroup(
    val key: String,
    val title: String,
    val branch: String?,
    val sessions: List<SessionListItem>,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionListScreen(
    sessions: List<SessionListItem>,
    runningIds: Set<String>,
    connection: ConnectionState,
    error: String?,
    refreshing: Boolean,
    onRefresh: () -> Unit,
    onOpen: (String) -> Unit,
    onUnpair: () -> Unit,
    onNewSession: () -> Unit = {},
    serverUrl: String = "",
    deviceId: String = "",
    currentModel: ModelRef? = null,
    models: List<RelayModelOption> = emptyList(),
    usageData: JSONObject? = null,
    settings: JSONObject? = null,
    onRefreshUsage: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
    onOpenUsage: () -> Unit = {},
    onUpdateSetting: (String, Any?) -> Unit = { _, _ -> },
) {
    var query by rememberSaveable { mutableStateOf("") }
    var runningOnly by rememberSaveable { mutableStateOf(false) }
    var collapsed by rememberSaveable { mutableStateOf(emptySet<String>()) }
    var settingsOpen by remember { mutableStateOf(false) }
    var usageOpen by remember { mutableStateOf(false) }
    val korean = remember { Locale.getDefault().language == "ko" }
    val now = System.currentTimeMillis()

    val groups = remember(sessions, runningIds, query, runningOnly) {
        val q = query.trim()
        val visible = sessions.filter { session ->
            (q.isBlank() ||
                sessionTitle(session).contains(q, ignoreCase = true) ||
                session.cwd.contains(q, ignoreCase = true) ||
                session.id.contains(q, ignoreCase = true)) &&
                (!runningOnly || session.id in runningIds)
        }
        visible.groupBy { session ->
            session.projectRoot ?: session.cwd
        }.map { (key, list) ->
            ProjectGroup(
                key = key,
                title = key.substringAfterLast('/').ifBlank { key },
                branch = list.mapNotNull { it.worktreeBranch?.takeIf { b -> b.isNotBlank() } }
                    .firstOrNull(),
                sessions = list.sortedWith(
                    compareByDescending<SessionListItem> {
                        parseInstant(it.modified)?.toEpochMilli() ?: Long.MIN_VALUE
                    },
                ),
            )
        }.sortedWith(
            compareByDescending<ProjectGroup> { group ->
                group.sessions.mapNotNull { parseInstant(it.modified)?.toEpochMilli() }
                    .maxOrNull() ?: Long.MIN_VALUE
            }.thenBy { it.title.lowercase() },
        )
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(OmpColors.Bg)
            .safeDrawingPadding(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp)
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "ompgui",
                fontWeight = FontWeight.Bold,
                fontSize = 20.sp,
                letterSpacing = (-0.5).sp,
                color = OmpColors.Text,
            )
            Spacer(modifier = Modifier.width(6.dp))
            Text(
                text = "v0.6.5",
                fontSize = 12.sp,
                color = OmpColors.TextDim,
            )
            Spacer(modifier = Modifier.weight(1f))
            Box(
                modifier = Modifier
                    .height(36.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(OmpColors.AccentStrong)
                    .clickable(onClick = onNewSession)
                    .padding(horizontal = 12.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "+ " + stringResource(R.string.new_session),
                    color = androidx.compose.ui.graphics.Color.White,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            Spacer(modifier = Modifier.width(4.dp))
            IconButton(onClick = onRefresh, modifier = Modifier.size(44.dp)) {
                Icon(
                    imageVector = Icons.Filled.Refresh,
                    contentDescription = stringResource(R.string.sessions_refresh),
                    tint = OmpColors.TextMuted,
                )
            }
            IconButton(
                onClick = { usageOpen = true; onOpenUsage() },
                modifier = Modifier.size(44.dp),
            ) {
                Icon(
                    imageVector = Icons.Filled.Speed,
                    contentDescription = "Usage",
                    tint = OmpColors.TextMuted,
                )
            }
            IconButton(
                onClick = { settingsOpen = true; onOpenSettings() },
                modifier = Modifier.size(44.dp),
            ) {
                Icon(
                    imageVector = Icons.Filled.Settings,
                    contentDescription = "Settings",
                    tint = OmpColors.TextMuted,
                )
            }
            IconButton(onClick = onUnpair, modifier = Modifier.size(44.dp)) {
                Icon(
                    imageVector = Icons.Filled.LinkOff,
                    contentDescription = stringResource(R.string.sessions_unpair),
                    tint = OmpColors.TextMuted,
                )
            }
        }
        if (connection != ConnectionState.Connected) {
            Text(
                text = when (connection) {
                    ConnectionState.Connecting -> stringResource(R.string.status_connecting)
                    ConnectionState.Failed -> stringResource(R.string.status_failed)
                    else -> stringResource(R.string.status_idle)
                },
                color = OmpColors.TextMuted,
                fontSize = 12.sp,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }
        if (!error.isNullOrBlank()) {
            Text(
                error,
                color = OmpColors.StatusError,
                fontSize = 12.sp,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 4.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp))
                    .background(OmpColors.BgPanel, RoundedCornerShape(8.dp))
                    .padding(horizontal = 12.dp),
                contentAlignment = Alignment.Center,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Filled.Search,
                        contentDescription = null,
                        tint = OmpColors.TextDim,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    BasicTextField(
                        value = query,
                        onValueChange = { query = it },
                        singleLine = true,
                        textStyle = TextStyle(
                            color = OmpColors.Text,
                            fontSize = 14.sp,
                        ),
                        cursorBrush = SolidColor(OmpColors.Text),
                        modifier = Modifier.fillMaxWidth(),
                        decorationBox = { inner ->
                            Box {
                                if (query.isEmpty()) {
                                    Text(
                                        text = stringResource(R.string.search_sessions_placeholder),
                                        color = OmpColors.TextDim,
                                        fontSize = 14.sp,
                                    )
                                }
                                inner()
                            }
                        },
                    )
                }
            }
            Row(
                modifier = Modifier
                    .clip(CircleShape)
                    .background(if (runningOnly) OmpColors.BgHover else androidx.compose.ui.graphics.Color.Transparent)
                    .border(
                        1.dp,
                        if (runningOnly) OmpColors.Accent else OmpColors.Border,
                        CircleShape,
                    )
                    .clickable { runningOnly = !runningOnly }
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier
                        .size(6.dp)
                        .clip(CircleShape)
                        .background(
                            if (runningOnly) OmpColors.StatusSuccess else OmpColors.TextDim,
                        ),
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = stringResource(R.string.filter_running_only),
                    fontSize = 12.sp,
                    color = if (runningOnly) OmpColors.Text else OmpColors.TextMuted,
                )
            }
        }
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = onRefresh,
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
        ) {
            if (groups.isEmpty()) {
                Text(
                    stringResource(R.string.sessions_empty),
                    color = OmpColors.TextMuted,
                    fontSize = 14.sp,
                    modifier = Modifier.padding(24.dp),
                )
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(groups, key = { it.key }) { group ->
                        val expanded = group.key !in collapsed
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .border(1.dp, OmpColors.Border, RoundedCornerShape(12.dp))
                                .background(OmpColors.BgPanel, RoundedCornerShape(12.dp))
                                .clip(RoundedCornerShape(12.dp)),
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        collapsed = if (expanded) {
                                            collapsed + group.key
                                        } else {
                                            collapsed - group.key
                                        }
                                    }
                                    .padding(horizontal = 14.dp, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(
                                    imageVector = Icons.Filled.Folder,
                                    contentDescription = null,
                                    tint = OmpColors.Accent,
                                    modifier = Modifier.size(18.dp),
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = group.title,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 15.sp,
                                    color = OmpColors.Text,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f),
                                )
                                if (group.branch != null) {
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Box(
                                        modifier = Modifier
                                            .border(
                                                1.dp,
                                                OmpColors.Border,
                                                RoundedCornerShape(4.dp),
                                            )
                                            .background(
                                                OmpColors.BgHover,
                                                RoundedCornerShape(4.dp),
                                            )
                                            .padding(horizontal = 6.dp, vertical = 2.dp),
                                    ) {
                                        Text(
                                            text = group.branch,
                                            fontSize = 11.sp,
                                            color = OmpColors.TextMuted,
                                            maxLines = 1,
                                        )
                                    }
                                }
                                Spacer(modifier = Modifier.width(6.dp))
                                Box(
                                    modifier = Modifier
                                        .border(
                                            1.dp,
                                            OmpColors.Border,
                                            RoundedCornerShape(4.dp),
                                        )
                                        .background(
                                            OmpColors.BgHover,
                                            RoundedCornerShape(4.dp),
                                        )
                                        .padding(horizontal = 6.dp, vertical = 2.dp),
                                ) {
                                    Text(
                                        text = group.sessions.size.toString(),
                                        fontSize = 11.sp,
                                        color = OmpColors.TextDim,
                                    )
                                }
                                Icon(
                                    imageVector = if (expanded) {
                                        Icons.Filled.ExpandLess
                                    } else {
                                        Icons.Filled.ExpandMore
                                    },
                                    contentDescription = null,
                                    tint = OmpColors.TextMuted,
                                )
                            }
                            if (expanded) {
                                HorizontalDivider(
                                    color = OmpColors.Border,
                                    thickness = 1.dp,
                                )
                                group.sessions.forEach { session ->
                                    SessionItemRow(
                                        session = session,
                                        running = session.id in runningIds,
                                        now = now,
                                        korean = korean,
                                        onClick = { onOpen(session.id) },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(OmpColors.BgPanel)
                .padding(horizontal = 12.dp, vertical = 4.dp),
        ) {
            HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
            FooterNavRow(
                icon = Icons.Filled.Settings,
                label = if (korean) "설정" else "Settings",
                onClick = { settingsOpen = true; onOpenSettings() },
            )
            FooterNavRow(
                icon = Icons.Filled.Speed,
                label = if (korean) "사용량" else "Usage",
                onClick = { usageOpen = true; onOpenUsage() },
            )
        }
        if (settingsOpen) {
            SettingsSheet(
                serverUrl = serverUrl,
                deviceId = deviceId,
                connection = connection,
                currentModel = currentModel,
                models = models,
                settings = settings,
                onUpdateSetting = onUpdateSetting,
                onUnpair = onUnpair,
                onDismiss = { settingsOpen = false },
            )
        }
        if (usageOpen) {
            UsageSheet(
                usageData = usageData,
                onRefresh = onRefreshUsage,
                onDismiss = { usageOpen = false },
            )
        }
    }
}

@Composable
private fun FooterNavRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 4.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = OmpColors.TextMuted,
            modifier = Modifier.size(20.dp),
        )
        Spacer(modifier = Modifier.width(12.dp))
        Text(
            text = label,
            fontSize = 14.sp,
            color = OmpColors.Text,
            modifier = Modifier.weight(1f),
        )
        Icon(
            imageVector = Icons.Filled.ChevronRight,
            contentDescription = null,
            tint = OmpColors.TextDim,
            modifier = Modifier.size(18.dp),
        )
    }
}

@Composable
private fun SessionItemRow(
    session: SessionListItem,
    running: Boolean,
    now: Long,
    korean: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (running) {
            RunningDot()
            Spacer(modifier = Modifier.width(8.dp))
        }
        Text(
            text = sessionTitle(session),
            color = OmpColors.Text,
            fontSize = 14.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        Spacer(modifier = Modifier.width(8.dp))
        relativeLabel(session.modified, now, korean)?.let { label ->
            Text(
                text = label,
                color = OmpColors.TextDim,
                fontSize = 12.sp,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun RunningDot() {
    val transition = rememberInfiniteTransition(label = "running")
    val alpha by transition.animateFloat(
        initialValue = 1f,
        targetValue = 0.35f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 900),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "alpha",
    )
    Box(
        modifier = Modifier
            .size(8.dp)
            .clip(CircleShape)
            .background(OmpColors.StatusSuccess.copy(alpha = alpha)),
    )
}

private fun sessionTitle(session: SessionListItem): String =
    session.name?.takeIf { it.isNotBlank() }
        ?: session.firstMessage.takeIf { it.isNotBlank() }
        ?: session.id

private fun parseInstant(raw: String): Instant? {
    if (raw.isBlank()) return null
    try {
        return Instant.parse(raw)
    } catch (_: Exception) {
    }
    try {
        return OffsetDateTime.parse(raw).toInstant()
    } catch (_: Exception) {
    }
    return try {
        LocalDateTime.parse(raw).atZone(ZoneId.systemDefault()).toInstant()
    } catch (_: Exception) {
        null
    }
}

private fun relativeLabel(modified: String, now: Long, korean: Boolean): String? {
    val instant = parseInstant(modified) ?: return null
    val millis = instant.toEpochMilli()
    val minutes = maxOf(0L, (now - millis) / 60_000L)
    if (minutes < 1) return if (korean) "현재 분" else "now"
    if (minutes < 60) return if (korean) "${minutes}분 전" else "${minutes}m ago"
    val hours = minutes / 60
    if (hours < 24) return if (korean) "${hours}시간 전" else "${hours}h ago"
    val days = hours / 24
    if (days <= 1) return if (korean) "어제" else "yesterday"
    val zoned = instant.atZone(ZoneId.systemDefault())
    val thisYear = LocalDateTime.now().year == zoned.year
    return if (korean) {
        if (thisYear) "${zoned.monthValue}월 ${zoned.dayOfMonth}일"
        else "${zoned.year}년 ${zoned.monthValue}월 ${zoned.dayOfMonth}일"
    } else {
        val pattern = if (thisYear) "MMM d" else "MMM d, yyyy"
        zoned.format(DateTimeFormatter.ofPattern(pattern, Locale.ENGLISH))
    }
}
