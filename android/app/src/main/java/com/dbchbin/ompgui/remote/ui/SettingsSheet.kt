package com.dbchbin.ompgui.remote.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dbchbin.ompgui.remote.net.ConnectionState
import com.dbchbin.ompgui.remote.relay.ModelRef
import com.dbchbin.ompgui.remote.relay.RelayModelOption
import java.util.Locale
import org.json.JSONObject

private enum class SettingsCategory(val ko: String, val en: String) {
    GENERAL("일반", "General"),
    SAFETY("안전", "Safety"),
    MODELS("모델", "Models"),
    INTELLIGENCE("인텔리전스", "Intelligence"),
    AGENTS("에이전트", "Agents"),
    TOOLS("도구", "Tools"),
    SYSTEM("시스템", "System"),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsSheet(
    serverUrl: String,
    connection: ConnectionState,
    currentModel: ModelRef?,
    onUnpair: () -> Unit,
    onDismiss: () -> Unit,
    settings: JSONObject? = null,
    deviceId: String = "",
    models: List<RelayModelOption> = emptyList(),
    onUpdateSetting: (String, Any?) -> Unit = { _, _ -> },
) {
    val korean = remember { Locale.getDefault().language == "ko" }
    val connected = connection == ConnectionState.Connected
    var category by remember { mutableStateOf(SettingsCategory.GENERAL) }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = OmpColors.BgPanel,
        contentColor = OmpColors.Text,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 32.dp),
        ) {
            Text(
                text = if (korean) "설정" else "Settings",
                fontSize = 17.sp,
                fontWeight = FontWeight.Bold,
                color = OmpColors.Text,
                modifier = Modifier.padding(vertical = 8.dp),
            )
            CategoryTabs(
                selected = category,
                korean = korean,
                onSelect = { category = it },
            )
            HorizontalDivider(
                color = OmpColors.Border,
                thickness = 1.dp,
                modifier = Modifier.padding(vertical = 8.dp),
            )
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                when (category) {
                    SettingsCategory.GENERAL -> GeneralSection(
                        korean = korean,
                        settings = settings,
                        onUpdateSetting = onUpdateSetting,
                    )
                    SettingsCategory.SAFETY -> SafetySection(
                        korean = korean,
                        settings = settings,
                        onUpdateSetting = onUpdateSetting,
                    )
                    SettingsCategory.MODELS -> ModelsSection(
                        korean = korean,
                        settings = settings,
                        currentModel = currentModel,
                        models = models,
                        onUpdateSetting = onUpdateSetting,
                    )
                    SettingsCategory.INTELLIGENCE -> IntelligenceSection(
                        korean = korean,
                        settings = settings,
                        onUpdateSetting = onUpdateSetting,
                    )
                    SettingsCategory.AGENTS -> AgentsSection(
                        korean = korean,
                        settings = settings,
                        onUpdateSetting = onUpdateSetting,
                    )
                    SettingsCategory.TOOLS -> ToolsSection(
                        korean = korean,
                        settings = settings,
                        onUpdateSetting = onUpdateSetting,
                    )
                    SettingsCategory.SYSTEM -> SystemSection(
                        korean = korean,
                        serverUrl = serverUrl,
                        deviceId = deviceId,
                        connected = connected,
                        onUnpair = onUnpair,
                    )
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Category navigation.
// ---------------------------------------------------------------------------

@Composable
private fun CategoryTabs(
    selected: SettingsCategory,
    korean: Boolean,
    onSelect: (SettingsCategory) -> Unit,
) {
    LazyRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        contentPadding = PaddingValues(vertical = 4.dp),
    ) {
        items(SettingsCategory.entries, key = { it.name }) { entry ->
            val isSelected = entry == selected
            Box(
                modifier = Modifier
                    .height(44.dp)
                    .clip(RoundedCornerShape(50))
                    .background(if (isSelected) OmpColors.AccentStrong else OmpColors.BgHover)
                    .border(
                        1.dp,
                        if (isSelected) OmpColors.AccentStrong else OmpColors.Border,
                        RoundedCornerShape(50),
                    )
                    .clickable(onClick = { onSelect(entry) })
                    .padding(horizontal = 14.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = if (korean) entry.ko else entry.en,
                    fontSize = 13.sp,
                    fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                    color = if (isSelected) Color.White else OmpColors.TextMuted,
                    maxLines = 1,
                )
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Building blocks: cards, toggles, option chips.
// ---------------------------------------------------------------------------

@Composable
private fun SettingsCard(content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(OmpColors.BgHover)
            .border(1.dp, OmpColors.Border, shape)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        content()
    }
}

@Composable
private fun SettingsSection(title: String) {
    Text(
        text = title,
        fontSize = 12.sp,
        color = OmpColors.TextDim,
        modifier = Modifier.padding(top = 8.dp, bottom = 4.dp),
    )
}

@Composable
private fun SettingsToggleRow(
    label: String,
    description: String? = null,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .clip(RoundedCornerShape(8.dp))
            .clickable(onClick = { onCheckedChange(!checked) })
            .padding(horizontal = 4.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
            Text(text = label, fontSize = 14.sp, color = OmpColors.Text)
            if (description != null) {
                Spacer(modifier = Modifier.height(2.dp))
                Text(text = description, fontSize = 12.sp, color = OmpColors.TextMuted)
            }
        }
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Color.White,
                checkedTrackColor = OmpColors.AccentStrong,
                uncheckedThumbColor = OmpColors.TextMuted,
                uncheckedTrackColor = OmpColors.BgSelected,
                uncheckedBorderColor = OmpColors.Border,
            ),
        )
    }
}

@Composable
private fun SettingsOptionGroup(
    label: String,
    description: String? = null,
    options: List<String>,
    selected: String?,
    onSelect: (String) -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(text = label, fontSize = 14.sp, color = OmpColors.Text)
        if (description != null) {
            Spacer(modifier = Modifier.height(2.dp))
            Text(text = description, fontSize = 12.sp, color = OmpColors.TextMuted)
        }
        Spacer(modifier = Modifier.height(8.dp))
        LazyRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(options, key = { it }) { option ->
                val isSelected = option == selected
                Box(
                    modifier = Modifier
                        .height(44.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (isSelected) OmpColors.BgSelected else Color.Transparent)
                        .border(
                            1.dp,
                            if (isSelected) OmpColors.Accent else OmpColors.Border,
                            RoundedCornerShape(8.dp),
                        )
                        .clickable(onClick = { onSelect(option) })
                        .padding(horizontal = 14.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = option,
                        fontSize = 13.sp,
                        fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (isSelected) OmpColors.Text else OmpColors.TextMuted,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

@Composable
private fun SettingsRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text = label, fontSize = 14.sp, color = OmpColors.TextMuted)
        Spacer(modifier = Modifier.width(12.dp))
        Text(
            text = value,
            fontSize = 14.sp,
            color = OmpColors.Text,
            textAlign = androidx.compose.ui.text.style.TextAlign.End,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
    }
}

// ---------------------------------------------------------------------------
// 일반 (General).
// ---------------------------------------------------------------------------

@Composable
private fun GeneralSection(
    korean: Boolean,
    settings: JSONObject?,
    onUpdateSetting: (String, Any?) -> Unit,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val prefs = remember(context) {
        context.getSharedPreferences("ompgui_app_prefs", android.content.Context.MODE_PRIVATE)
    }
    val systemLanguage = remember { Locale.getDefault().language }
    var language by remember {
        mutableStateOf(
            prefs.getString("language", if (systemLanguage == "ko") "한국어" else "English") ?: "한국어",
        )
    }
    var soundChime by remember {
        mutableStateOf(prefs.getBoolean("soundChime", true))
    }
    var submissionMode by remember {
        mutableStateOf(prefs.getString("submissionMode", "enter") ?: "enter")
    }

    SettingsSection(title = if (korean) "인터페이스" else "Interface")
    SettingsCard {
        SettingsRow(
            label = if (korean) "테마" else "Theme",
            value = "Warm-Ember Dark",
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsOptionGroup(
            label = if (korean) "언어" else "Language",
            options = listOf("한국어", "English", "日本語", "简体中文"),
            selected = language,
            onSelect = {
                language = it
                prefs.edit().putString("language", it).apply()
            },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsToggleRow(
            label = if (korean) "완료 알림음" else "Completion chime",
            description = if (korean) "에이전트 작업 완료 시 소리 재생" else "Play a sound when the agent finishes",
            checked = soundChime,
            onCheckedChange = {
                soundChime = it
                prefs.edit().putBoolean("soundChime", it).apply()
            },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsOptionGroup(
            label = if (korean) "전송 방식" else "Submission mode",
            description = if (korean) "메시지 전송 키 설정" else "Key binding used to send a message",
            options = listOf("enter", "shift-enter", "steer", "followup"),
            selected = submissionMode,
            onSelect = {
                submissionMode = it
                prefs.edit().putString("submissionMode", it).apply()
            },
        )
    }
}

// ---------------------------------------------------------------------------
// 안전 (Safety & Approvals).
// ---------------------------------------------------------------------------

@Composable
private fun SafetySection(
    korean: Boolean,
    settings: JSONObject?,
    onUpdateSetting: (String, Any?) -> Unit,
) {
    SettingsSection(title = if (korean) "승인" else "Approvals")
    SettingsCard {
        SettingsOptionGroup(
            label = if (korean) "도구 승인 모드" else "Tool approval mode",
            description = if (korean) "도구 실행 전 승인 방식" else "How tool runs are approved",
            options = listOf("always-ask", "write", "yolo"),
            selected = settings.nestedString("tools", "approvalMode", "always-ask"),
            onSelect = { onUpdateSetting("tools.approvalMode", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsOptionGroup(
            label = if (korean) "Bash 명령 승인" else "Bash command approval",
            description = if (korean) "셸 명령 실행 정책" else "Policy for shell commands",
            options = listOf("prompt", "allow", "deny"),
            selected = settings.deepString(listOf("tools", "approval", "bash"), "prompt"),
            onSelect = { onUpdateSetting("tools.approval.bash", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsOptionGroup(
            label = if (korean) "확장 도구 승인" else "Extension tool approval",
            description = if (korean) "확장 도구 실행 정책" else "Policy for extension tools",
            options = listOf("prompt", "allow"),
            selected = settings.deepString(listOf("tools", "approval", "extension"), "prompt"),
            onSelect = { onUpdateSetting("tools.approval.extension", it) },
        )
    }
}

// ---------------------------------------------------------------------------
// 모델 (AI Model Defaults).
// ---------------------------------------------------------------------------

@Composable
private fun ModelsSection(
    korean: Boolean,
    settings: JSONObject?,
    currentModel: ModelRef?,
    models: List<RelayModelOption> = emptyList(),
    onUpdateSetting: (String, Any?) -> Unit,
) {
    SettingsSection(title = if (korean) "AI 모델 기본값" else "AI Model Defaults")
    SettingsCard {
        SettingsRow(
            label = if (korean) "현재 모델" else "Current model",
            value = currentModel?.let { "${it.displayName()} · ${it.provider}" }
                ?: if (korean) "알 수 없음" else "Unknown",
        )
        if (models.isNotEmpty()) {
            HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
            val modelNames = remember(models) { models.map { it.name }.distinct() }
            val currentName = currentModel?.displayName()
            SettingsOptionGroup(
                label = if (korean) "기본 모델" else "Default Model",
                description = if (korean) "새 세션의 기본 모델" else "Default model for new sessions",
                options = modelNames,
                selected = settings.topString("defaultModel", currentName ?: modelNames.first()),
                onSelect = { onUpdateSetting("defaultModel", it) },
            )
        }
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsOptionGroup(
            label = if (korean) "기본 Thinking Level" else "Default thinking level",
            options = listOf("auto", "minimal", "low", "medium", "high", "xhigh", "max"),
            selected = settings.topString("defaultThinkingLevel", "auto"),
            onSelect = { onUpdateSetting("defaultThinkingLevel", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsOptionGroup(
            label = if (korean) "텍스트 상세도" else "Text verbosity",
            options = listOf("low", "medium", "high"),
            selected = settings.topString("textVerbosity", "medium"),
            onSelect = { onUpdateSetting("textVerbosity", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsOptionGroup(
            label = if (korean) "성격" else "Personality",
            options = listOf("default", "friendly", "pragmatic", "none"),
            selected = settings.topString("personality", "default"),
            onSelect = { onUpdateSetting("personality", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsToggleRow(
            label = if (korean) "Thinking 블록 숨기기" else "Hide thinking block",
            checked = settings.topBool("hideThinkingBlock", false),
            onCheckedChange = { onUpdateSetting("hideThinkingBlock", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsToggleRow(
            label = if (korean) "외부 Thinking" else "External thinking",
            checked = settings.topBool("externalThinking", false),
            onCheckedChange = { onUpdateSetting("externalThinking", it) },
        )
    }
}

// ---------------------------------------------------------------------------
// 인텔리전스 (Intelligence & Memory).
// ---------------------------------------------------------------------------

@Composable
private fun IntelligenceSection(
    korean: Boolean,
    settings: JSONObject?,
    onUpdateSetting: (String, Any?) -> Unit,
) {
    SettingsSection(title = if (korean) "인텔리전스 및 메모리" else "Intelligence & Memory")
    SettingsCard {
        SettingsToggleRow(
            label = if (korean) "자동 압축" else "Auto-compaction",
            description = "compaction.enabled",
            checked = settings.nestedBool("compaction", "enabled", true),
            onCheckedChange = { onUpdateSetting("compaction.enabled", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsToggleRow(
            label = if (korean) "턴 중간 압축" else "Mid-turn compaction",
            description = "compaction.midTurnEnabled",
            checked = settings.nestedBool("compaction", "midTurnEnabled", false),
            onCheckedChange = { onUpdateSetting("compaction.midTurnEnabled", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsOptionGroup(
            label = if (korean) "압축 전략" else "Compaction strategy",
            options = listOf("snapcompact", "handoff", "context-full", "shake", "off"),
            selected = settings.nestedString("compaction", "strategy", "snapcompact"),
            onSelect = { onUpdateSetting("compaction.strategy", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsToggleRow(
            label = if (korean) "압축 후 자동 계속" else "Auto-continue compaction",
            description = "compaction.autoContinue",
            checked = settings.nestedBool("compaction", "autoContinue", true),
            onCheckedChange = { onUpdateSetting("compaction.autoContinue", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsToggleRow(
            label = if (korean) "자동 재시도" else "Auto-retry",
            description = "retry.enabled",
            checked = settings.nestedBool("retry", "enabled", true),
            onCheckedChange = { onUpdateSetting("retry.enabled", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsOptionGroup(
            label = if (korean) "최대 재시도 횟수" else "Max retries",
            description = "retry.maxRetries (1–20)",
            options = (1..20).map { it.toString() },
            selected = settings.nestedInt("retry", "maxRetries", 3).toString(),
            onSelect = { onUpdateSetting("retry.maxRetries", it.toInt()) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsToggleRow(
            label = if (korean) "모델 폴백" else "Model fallback",
            description = "retry.modelFallback",
            checked = settings.nestedBool("retry", "modelFallback", false),
            onCheckedChange = { onUpdateSetting("retry.modelFallback", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsOptionGroup(
            label = if (korean) "폴백 복구 정책" else "Fallback revert policy",
            description = "retry.fallbackRevertPolicy",
            options = listOf("cooldown-expiry", "never"),
            selected = settings.nestedString("retry", "fallbackRevertPolicy", "cooldown-expiry"),
            onSelect = { onUpdateSetting("retry.fallbackRevertPolicy", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsOptionGroup(
            label = if (korean) "메모리 백엔드" else "Memory backend",
            description = "memory.backend",
            options = listOf("mnemopi", "local", "hindsight", "off"),
            selected = settings.nestedString("memory", "backend", "local"),
            onSelect = { onUpdateSetting("memory.backend", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsOptionGroup(
            label = if (korean) "Mnemopi 범위" else "Mnemopi scoping",
            description = "mnemopi.scoping",
            options = listOf("global", "per-project", "per-project-tagged"),
            selected = settings.nestedString("mnemopi", "scoping", "global"),
            onSelect = { onUpdateSetting("mnemopi.scoping", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsToggleRow(
            label = if (korean) "자동 학습" else "Auto-learn",
            description = "autolearn.enabled",
            checked = settings.nestedBool("autolearn", "enabled", false),
            onCheckedChange = { onUpdateSetting("autolearn.enabled", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsToggleRow(
            label = if (korean) "자동 학습 자동 계속" else "Auto-learn auto-continue",
            description = "autolearn.autoContinue",
            checked = settings.nestedBool("autolearn", "autoContinue", false),
            onCheckedChange = { onUpdateSetting("autolearn.autoContinue", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsToggleRow(
            label = if (korean) "AI 어드바이저" else "AI advisor",
            description = "advisor.enabled",
            checked = settings.nestedBool("advisor", "enabled", true),
            onCheckedChange = { onUpdateSetting("advisor.enabled", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsToggleRow(
            label = if (korean) "서브에이전트 어드바이저" else "Subagents advisor",
            description = "advisor.subagents",
            checked = settings.nestedBool("advisor", "subagents", false),
            onCheckedChange = { onUpdateSetting("advisor.subagents", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsOptionGroup(
            label = if (korean) "어드바이저 동기화 백로그" else "Advisor sync backlog",
            description = "advisor.syncBacklog",
            options = listOf("off", "1", "3", "5"),
            selected = settings.nestedString("advisor", "syncBacklog", "off"),
            onSelect = { onUpdateSetting("advisor.syncBacklog", it) },
        )
    }
}

// ---------------------------------------------------------------------------
// 에이전트 (Agents & Subagents).
// ---------------------------------------------------------------------------

@Composable
private fun AgentsSection(
    korean: Boolean,
    settings: JSONObject?,
    onUpdateSetting: (String, Any?) -> Unit,
) {
    SettingsSection(title = if (korean) "에이전트" else "Agents & Subagents")
    SettingsCard {
        SettingsOptionGroup(
            label = if (korean) "Task Eager Spawning" else "Task eager spawning",
            description = "task.eager",
            options = listOf("default", "preferred", "always"),
            selected = settings.nestedString("task", "eager", "default"),
            onSelect = { onUpdateSetting("task.eager", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsToggleRow(
            label = if (korean) "사전 워크스페이스 분석" else "Prewalk workspace analysis",
            description = "task.prewalk",
            checked = settings.nestedBool("task", "prewalk", false),
            onCheckedChange = { onUpdateSetting("task.prewalk", it) },
        )
    }
}

// ---------------------------------------------------------------------------
// 도구 (Extensions & Tools).
// ---------------------------------------------------------------------------

@Composable
private fun ToolsSection(
    korean: Boolean,
    settings: JSONObject?,
    onUpdateSetting: (String, Any?) -> Unit,
) {
    SettingsSection(title = if (korean) "확장 및 도구" else "Extensions & Tools")
    SettingsCard {
        SettingsToggleRow(
            label = if (korean) "웹 검색" else "Web Search",
            description = "web_search.enabled",
            checked = settings.nestedBool("web_search", "enabled", true),
            onCheckedChange = { onUpdateSetting("web_search.enabled", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsToggleRow(
            label = "GitHub CLI",
            description = "github.enabled",
            checked = settings.nestedBool("github", "enabled", true),
            onCheckedChange = { onUpdateSetting("github.enabled", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsToggleRow(
            label = if (korean) "헤드리스 브라우저" else "Headless Browser",
            description = "browser.enabled",
            checked = settings.nestedBool("browser", "enabled", true),
            onCheckedChange = { onUpdateSetting("browser.enabled", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsToggleRow(
            label = if (korean) "헤드리스 브라우저 모드" else "Headless Browser Mode",
            description = "browser.headless",
            checked = settings.nestedBool("browser", "headless", true),
            onCheckedChange = { onUpdateSetting("browser.headless", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsToggleRow(
            label = if (korean) "컴퓨터 제어" else "Computer Control",
            description = "computer.enabled",
            checked = settings.nestedBool("computer", "enabled", true),
            onCheckedChange = { onUpdateSetting("computer.enabled", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsToggleRow(
            label = if (korean) "보안 감사" else "Security Audit",
            description = "security.enabled",
            checked = settings.nestedBool("security", "enabled", true),
            onCheckedChange = { onUpdateSetting("security.enabled", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsToggleRow(
            label = if (korean) "체크포인트" else "Checkpoint",
            description = "checkpoint.enabled",
            checked = settings.nestedBool("checkpoint", "enabled", true),
            onCheckedChange = { onUpdateSetting("checkpoint.enabled", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsToggleRow(
            label = if (korean) "MCP 프로젝트 설정" else "MCP project config",
            description = "mcp.enableProjectConfig",
            checked = settings.nestedBool("mcp", "enableProjectConfig", true),
            onCheckedChange = { onUpdateSetting("mcp.enableProjectConfig", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsToggleRow(
            label = if (korean) "MCP 마크다운 결과 렌더링" else "MCP render markdown results",
            description = "mcp.renderMarkdownResults",
            checked = settings.nestedBool("mcp", "renderMarkdownResults", true),
            onCheckedChange = { onUpdateSetting("mcp.renderMarkdownResults", it) },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsToggleRow(
            label = if (korean) "MCP 알림" else "MCP notifications",
            description = "mcp.notifications",
            checked = settings.nestedBool("mcp", "notifications", true),
            onCheckedChange = { onUpdateSetting("mcp.notifications", it) },
        )
    }
}

// ---------------------------------------------------------------------------
// 시스템 (System & Relay).
// ---------------------------------------------------------------------------

@Composable
private fun SystemSection(
    korean: Boolean,
    serverUrl: String,
    deviceId: String,
    connected: Boolean,
    onUnpair: () -> Unit,
) {
    SettingsSection(title = if (korean) "릴레이 연결" else "Relay & Pairing")
    SettingsCard {
        Text(
            text = if (korean) "릴레이 URL" else "Relay URL",
            fontSize = 12.sp,
            color = OmpColors.TextDim,
        )
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = serverUrl.ifBlank { "—" },
            fontSize = 13.sp,
            fontFamily = FontFamily.Monospace,
            color = OmpColors.Text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        HorizontalDivider(
            color = OmpColors.Border,
            thickness = 1.dp,
            modifier = Modifier.padding(vertical = 8.dp),
        )
        SettingsRow(
            label = if (korean) "기기 ID" else "Device ID",
            value = deviceId.ifBlank { "—" },
        )
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 44.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = if (korean) "상태" else "Status",
                fontSize = 14.sp,
                color = OmpColors.TextMuted,
            )
            Spacer(modifier = Modifier.weight(1f))
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(
                        if (connected) OmpColors.StatusSuccess else OmpColors.StatusError,
                    ),
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = if (connected) {
                    if (korean) "연결됨" else "Connected"
                } else {
                    if (korean) "연결 끊김" else "Disconnected"
                },
                fontSize = 14.sp,
                color = OmpColors.Text,
            )
        }
    }
    SettingsSection(title = if (korean) "정보" else "About")
    SettingsCard {
        SettingsRow(label = if (korean) "앱 버전" else "App version", value = "ompgui Remote v0.6.5")
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        SettingsRow(label = if (korean) "OMP 버전" else "OMP version", value = "v18.1.10")
    }
    Spacer(modifier = Modifier.height(4.dp))
    OutlinedButton(
        onClick = onUnpair,
        border = BorderStroke(1.dp, OmpColors.StatusError),
        colors = ButtonDefaults.outlinedButtonColors(
            contentColor = OmpColors.StatusError,
        ),
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp),
    ) {
        Text(text = if (korean) "페어링 해제" else "Unpair")
    }
}

// ---------------------------------------------------------------------------
// JSONObject access helpers (dotted keys resolve through nested objects).
// ---------------------------------------------------------------------------

private fun JSONObject?.topBool(key: String, default: Boolean): Boolean {
    if (this == null || isNull(key)) return default
    return optBoolean(key, default)
}

private fun JSONObject?.topString(key: String, default: String): String {
    val raw = this?.optString(key)
    return if (raw.isNullOrEmpty()) default else raw
}

private fun JSONObject?.nestedBool(section: String, key: String, default: Boolean): Boolean {
    val obj = this?.optJSONObject(section) ?: return default
    if (obj.isNull(key)) return default
    return obj.optBoolean(key, default)
}

private fun JSONObject?.nestedString(section: String, key: String, default: String): String {
    val raw = this?.optJSONObject(section)?.optString(key)
    return if (raw.isNullOrEmpty()) default else raw
}

private fun JSONObject?.nestedInt(section: String, key: String, default: Int): Int {
    val obj = this?.optJSONObject(section) ?: return default
    if (obj.isNull(key)) return default
    return obj.optInt(key, default)
}

private fun JSONObject?.deepString(path: List<String>, default: String): String {
    var current: JSONObject? = this
    for (segment in path.dropLast(1)) {
        current = current?.optJSONObject(segment) ?: return default
    }
    val raw = current?.optString(path.last())
    return if (raw.isNullOrEmpty()) default else raw
}
