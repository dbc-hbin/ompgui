package com.dbchbin.ompgui.remote.relay

/**
 * Client-side expansion of web-native slash commands. Matches
 * `lib/web-slash-commands.ts` so `/plan` etc. become real prompts instead of
 * literal slash text that omp's RPC path would ignore.
 */
sealed class SlashExpansion {
    data class Expand(val prompt: String) : SlashExpansion()
    data class UsageError(val command: String) : SlashExpansion()
    data object NotWeb : SlashExpansion()
}

private data class SlashDef(
    val name: String,
    val requiresArgs: Boolean,
    val build: (String) -> String,
)

private val WEB_SLASH = listOf(
    SlashDef("goal", true) { args ->
        "Work toward this goal for the rest of the session:\n\n$args\n\nTreat it as the objective to prioritize when deciding what to do next."
    },
    SlashDef("plan", true) { args ->
        "Create a plan for this task before doing anything else:\n\n$args\n\nThink it through step by step, list concrete steps, and state what you will verify when done."
    },
    SlashDef("review", false) { args ->
        if (args.isEmpty()) {
            "Review the current project state and recent changes for bugs, security issues, and opportunities to simplify. Summarize what you find, then fix anything clearly wrong."
        } else {
            "Review $args for bugs, security issues, and opportunities to simplify. Summarize what you find, then fix anything clearly wrong."
        }
    },
    SlashDef("fix", true) { args ->
        "Fix this issue:\n\n$args\n\nReproduce the problem, apply the smallest correct fix, and verify it works before finishing."
    },
    SlashDef("test", true) { args ->
        "Write tests for $args. Follow the project's test conventions, cover the important behavior and edge cases, and run the tests to confirm they pass."
    },
    SlashDef("explain", true) { args ->
        "Explain $args concisely: what it does, how it works, and the key details worth knowing."
    },
    SlashDef("simplify", true) { args ->
        "Simplify $args. Remove unnecessary complexity while preserving behavior, keep the change focused, and verify nothing breaks."
    },
    SlashDef("commit", false) { args ->
        if (args.isEmpty()) {
            "Stage the relevant files and commit the current changes with a clear conventional commit message. Run the project's checks first so the commit is green."
        } else {
            "Stage the relevant files and commit the current changes with this message: ${org.json.JSONObject.quote(args)}. Run the project's checks first so the commit is green."
        }
    },
)

private val WEB_SLASH_BY_NAME = WEB_SLASH.associateBy { it.name }

fun expandWebSlashCommand(text: String): SlashExpansion {
    if (!text.startsWith("/")) return SlashExpansion.NotWeb
    val match = Regex("^/([^\\s]+)(?:\\s+([\\s\\S]*))?$").matchEntire(text) ?: return SlashExpansion.NotWeb
    val def = WEB_SLASH_BY_NAME[match.groupValues[1]] ?: return SlashExpansion.NotWeb
    val args = match.groupValues.getOrNull(2)?.trim().orEmpty()
    if (def.requiresArgs && args.isEmpty()) {
        return SlashExpansion.UsageError("/${def.name}")
    }
    return SlashExpansion.Expand(def.build(args))
}
