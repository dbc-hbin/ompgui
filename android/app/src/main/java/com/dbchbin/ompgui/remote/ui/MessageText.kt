package com.dbchbin.ompgui.remote.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val ircSenderPattern = Regex("agent `([^`\\r\\n<>]+)`")

/** Message-only rendering; file previews and generic Markdown retain their original behavior. */
@Composable
fun MessageText(text: String, modifier: Modifier = Modifier, plainText: Boolean = false) {
    val ranges = remember(text) { parseInternalMessage(text) }
    if (ranges.none { it.tag != null }) {
        if (plainText) Text(text, modifier = modifier, fontSize = 14.sp, lineHeight = 20.sp, color = OmpColors.Text)
        else MarkdownText(text, modifier)
        return
    }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ranges.forEach { range ->
            key(range.tag, range.start) {
                if (range.tag != null) {
                    InternalMessageDisclosure(text, range)
                } else if ((range.start until range.endExclusive).any { !text[it].isWhitespace() }) {
                    val normal = remember(text, range) { text.substring(range.start, range.endExclusive) }
                    if (plainText) Text(normal, fontSize = 14.sp, lineHeight = 20.sp, color = OmpColors.Text)
                    else MarkdownText(normal)
                }
            }
        }
    }
}

@Composable
private fun InternalMessageDisclosure(text: String, range: MessageTextRange) {
    // End offsets and text change as tokens arrive; neither is disclosure identity.
    var expanded by rememberSaveable(range.tag, range.start) { mutableStateOf(false) }
    val korean = LocalContext.current.resources.configuration.locales[0].language == "ko"
    val sender = remember(text, range) {
        if (range.tag == "irc" && text.startsWith("<irc", range.start)) {
            val header = text.substring(range.start, range.start + minOf(512, range.endExclusive - range.start))
            ircSenderPattern.find(header)?.groupValues?.get(1)?.trim()?.takeIf { it.isNotEmpty() }
        } else null
    }
    val title = when (range.tag) {
        "irc" -> if (sender == null) {
            if (korean) "에이전트 간 메시지" else "Agent communication"
        } else if (korean) "에이전트 메시지 · $sender" else "Agent message · $sender"
        "system-directive" -> if (korean) "시스템 실행 지침" else "System instructions"
        "system-reminder" -> if (korean) "시스템 참고 정보" else "System context"
        "task-result" -> if (korean) "작업 결과 정보" else "Task result details"
        "task-notification" -> if (korean) "작업 상태 알림" else "Task status notification"
        else -> if (korean) "시스템 알림" else "System notice"
    }
    val icon = when (range.tag) {
        "irc" -> Icons.Filled.Forum
        "system-directive" -> Icons.Filled.Settings
        "system-reminder" -> Icons.Filled.Info
        "task-result" -> Icons.Filled.CheckCircle
        else -> Icons.Filled.Notifications
    }
    val action = if (expanded) { if (korean) "접기" else "Collapse" } else { if (korean) "펼치기" else "Expand" }
    val state = if (expanded) { if (korean) "펼쳐짐" else "Expanded" } else { if (korean) "접힘" else "Collapsed" }
    val compact = range.tag == "system-reminder" || range.tag == "system-directive"
    val shape = RoundedCornerShape(8.dp)
    Column(
        if (compact) Modifier.fillMaxWidth()
        else Modifier.fillMaxWidth().clip(shape).background(OmpColors.BgPanel)
            .border(1.dp, OmpColors.Border, shape),
    ) {
        Row(
            Modifier.fillMaxWidth().clickable(role = Role.Button, onClickLabel = action) { expanded = !expanded }
                .semantics { stateDescription = state }
                .heightIn(min = 48.dp).padding(
                    horizontal = if (compact) 4.dp else 12.dp,
                    vertical = if (compact) 0.dp else 8.dp,
                ),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(if (compact) 6.dp else 8.dp),
        ) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(if (compact) 14.dp else 18.dp), tint = OmpColors.TextMuted)
            Text(title, modifier = Modifier.weight(1f, fill = !compact),
                fontSize = if (compact) 12.sp else 13.sp,
                fontWeight = if (compact) FontWeight.Normal else FontWeight.Medium,
                color = if (compact) OmpColors.TextMuted else OmpColors.Text,
                maxLines = if (compact) Int.MAX_VALUE else 1, overflow = TextOverflow.Ellipsis)
            if (!compact) Text(action, fontSize = 12.sp, color = OmpColors.TextMuted)
            Icon(if (expanded) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown,
                contentDescription = null, modifier = Modifier.size(if (compact) 14.dp else 18.dp), tint = OmpColors.TextMuted)
        }
        if (expanded) {
            HorizontalDivider(color = OmpColors.Border)
            // Bound both copying and Text layout, not just viewport height. Every raw page
            // remains reachable without interpreting embedded Markdown or tool actions.
            val pageCount = ((range.endExclusive - range.start - 1) / InternalMessagePageSize + 1).coerceAtLeast(1)
            var selectedPage by rememberSaveable(range.tag, range.start) { mutableStateOf(0) }
            val page = selectedPage.coerceIn(0, pageCount - 1)
            val raw = remember(text, range, page) { internalMessageRawPage(text, range, page) }
            key(page) {
                SelectionContainer {
                    Text(raw, modifier = Modifier.fillMaxWidth().heightIn(max = 320.dp)
                        .verticalScroll(rememberScrollState()).padding(12.dp),
                        fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 18.sp, color = OmpColors.TextMuted)
                }
            }
            if (pageCount > 1) {
                Text(if (korean) "원문 ${page + 1} / ${pageCount}쪽" else "Raw text · page ${page + 1} of $pageCount",
                    modifier = Modifier.padding(horizontal = 12.dp), fontSize = 12.sp, color = OmpColors.TextMuted)
                Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    TextButton(onClick = { selectedPage = page - 1 }, enabled = page > 0, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(if (korean) "이전 페이지" else "Previous page")
                    }
                    TextButton(onClick = { selectedPage = page + 1 }, enabled = page + 1 < pageCount, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(if (korean) "다음 페이지" else "Next page")
                    }
                }
            }
        }
    }
}
