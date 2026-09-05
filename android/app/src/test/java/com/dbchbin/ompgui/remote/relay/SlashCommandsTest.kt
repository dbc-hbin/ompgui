package com.dbchbin.ompgui.remote.relay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SlashCommandsTest {
    @Test
    fun expandsPlanAndRejectsMissingArgs() {
        val expanded = expandWebSlashCommand("/plan ship the export")
        assertTrue(expanded is SlashExpansion.Expand)
        assertTrue((expanded as SlashExpansion.Expand).prompt.contains("ship the export"))

        val missing = expandWebSlashCommand("/plan")
        assertTrue(missing is SlashExpansion.UsageError)
        assertEquals("/plan", (missing as SlashExpansion.UsageError).command)

        assertTrue(expandWebSlashCommand("/unknown") is SlashExpansion.NotWeb)
        assertTrue(expandWebSlashCommand("hello") is SlashExpansion.NotWeb)
    }

    @Test
    fun expandsCommitWithoutArgs() {
        val expanded = expandWebSlashCommand("/commit") as SlashExpansion.Expand
        assertTrue(expanded.prompt.contains("conventional commit"))
    }
}
