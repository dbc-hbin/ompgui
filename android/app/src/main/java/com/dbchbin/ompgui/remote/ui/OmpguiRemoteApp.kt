package com.dbchbin.ompgui.remote.ui

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.dbchbin.ompgui.remote.net.ConnectionState

@Composable
fun OmpguiRemoteApp(viewModel: RemoteViewModel) {
    val state by viewModel.uiState.collectAsState()
    val usageData by viewModel.usage.collectAsState()
    val settings by viewModel.settings.collectAsState()
    var chatSettingsOpen by remember { mutableStateOf(false) }
    var chatUsageOpen by remember { mutableStateOf(false) }

    RemoteTheme {
        Surface {
            when (val screen = state.screen) {
                is RemoteScreen.Pairing -> PairingScreen(
                    uri = state.pairingUri,
                    password = state.password,
                    error = state.error,
                    connecting = state.connection == ConnectionState.Connecting,
                    onUriChange = viewModel::setPairingUri,
                    onPasswordChange = viewModel::setPassword,
                    onConnect = viewModel::pair,
                )
                is RemoteScreen.Sessions -> SessionListScreen(
                    sessions = state.sessions,
                    runningIds = state.runningIds,
                    connection = state.connection,
                    error = state.error,
                    refreshing = state.connection == ConnectionState.Connecting,
                    onRefresh = viewModel::refreshSessions,
                    onOpen = viewModel::openSession,
                    onUnpair = viewModel::unpair,
                    serverUrl = viewModel.getServerUrl(),
                    deviceId = viewModel.getDeviceId(),
                    currentModel = state.currentModel,
                    models = state.models,
                    usageData = usageData,
                    onRefreshUsage = viewModel::fetchUsage,
                    settings = settings,
                    onUpdateSetting = { key, value -> viewModel.updateSetting(key, value) },
                )
                is RemoteScreen.Chat -> {
                    ChatScreen(
                        title = state.chatTitle.ifBlank { screen.sessionId },
                        messages = state.messages,
                        draft = state.draft,
                        running = state.running,
                        connection = state.connection,
                        error = state.error,
                        models = state.models,
                        currentModel = state.currentModel,
                        pickerOpen = state.pickerOpen,
                        onDraftChange = viewModel::setDraft,
                        onSend = viewModel::sendPrompt,
                        onAbort = viewModel::abort,
                        onBack = viewModel::closeSession,
                        onOpenPicker = viewModel::openModelPicker,
                        onClosePicker = viewModel::closeModelPicker,
                        onSelectModel = viewModel::setModel,
                        onSendWithAttachments = { text, images -> viewModel.sendPrompt(text, images) },
                        onOpenUsage = {
                            viewModel.fetchUsage()
                            chatUsageOpen = true
                        },
                        onOpenSettings = {
                            viewModel.fetchSettings()
                            chatSettingsOpen = true
                        },
                    )
                    if (chatSettingsOpen) {
                        SettingsSheet(
                            serverUrl = viewModel.getServerUrl(),
                            deviceId = viewModel.getDeviceId(),
                            connection = state.connection,
                            currentModel = state.currentModel,
                            models = state.models,
                            settings = settings,
                            onUpdateSetting = { key, value -> viewModel.updateSetting(key, value) },
                            onUnpair = {
                                chatSettingsOpen = false
                                viewModel.unpair()
                            },
                            onDismiss = { chatSettingsOpen = false },
                        )
                    }
                    if (chatUsageOpen) {
                        UsageSheet(
                            usageData = usageData,
                            onRefresh = viewModel::fetchUsage,
                            onDismiss = { chatUsageOpen = false },
                        )
                    }
                }
            }
        }
    }
}
