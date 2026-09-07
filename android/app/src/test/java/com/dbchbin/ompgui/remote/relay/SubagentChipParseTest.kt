package com.dbchbin.ompgui.remote.relay

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SubagentChipParseTest {
    @Test
    fun normalizesStartedToRunningAndDropsUnknown() {
        assertEquals("running", normalizeSubagentStatus("started"))
        assertEquals("running", normalizeSubagentStatus("pending"))
        assertEquals("completed", normalizeSubagentStatus("completed"))
        assertNull(normalizeSubagentStatus(""))
        assertNull(normalizeSubagentStatus("lost-future"))

        val chips = parseSubagentChips(
            JSONArray()
                .put(JSONObject().put("id", "a1").put("agent", "scout").put("status", "started").put("task", "look"))
                .put(JSONObject().put("id", "a2").put("agent", "task").put("status", "completed"))
                .put(JSONObject().put("id", "bad").put("agent", "x").put("status", "nope")),
            live = true,
        )
        assertEquals(2, chips.size)
        assertEquals("running", chips[0].status)
        assertTrue(chips[0].live)
        assertEquals("completed", chips[1].status)
        assertFalse(chips[1].live)
    }

    @Test
    fun historicalStartedDoesNotCountAsLive() {
        val historical = parseSubagentChips(
            JSONArray()
                .put(JSONObject().put("id", "h1").put("agent", "scout").put("status", "started").put("task", "old"))
                .put(
                    JSONObject()
                        .put("id", "h2")
                        .put("agent", "task")
                        .put("status", "started")
                        .put("result", JSONObject().put("exitCode", 0)),
                ),
            live = false,
        )
        assertEquals(2, historical.size)
        assertFalse(historical[0].live)
        assertEquals("recorded", historical[0].status)
        assertFalse(isSubagentLive(historical[0]))
        // Startup is recorded, but completion requires terminal evidence.
        assertEquals("completed", historical[1].status)
        assertFalse(historical[1].live)

        // Empty live registry + history must not inflate hub live count or drop rows.
        val merged = mergeSubagentChips(emptyList(), historical)
        assertEquals(0, merged.count(::isSubagentLive))
        assertEquals(setOf("h1", "h2"), merged.map { it.id }.toSet())
        assertEquals("recorded", merged.first { it.id == "h1" }.status)
    }

    @Test
    fun reconcileDropsOmittedLiveRunningButKeepsHistory() {
        val previous = listOf(
            SubagentChip("live", "scout", "running", "now", live = true),
            SubagentChip("old", "task", "completed", "done", live = false),
            SubagentChip("hist-started", "task", "unknown", "past", live = false),
        )
        val snapshot = emptyList<SubagentChip>()
        val merged = reconcileSubagentChips(previous, snapshot)
        assertEquals(setOf("old", "hist-started"), merged.map { it.id }.toSet())
        assertEquals(0, merged.count(::isSubagentLive))
        assertEquals("completed", merged.first { it.id == "old" }.status)
        assertEquals("unknown", merged.first { it.id == "hist-started" }.status)
        assertFalse(merged.first { it.id == "hist-started" }.live)
    }

    @Test
    fun reconcileKeepsHistoricalTerminalsOmittedFromLiveSnapshot() {
        val previous = listOf(
            SubagentChip("live", "scout", "running", "now", live = true),
            SubagentChip("old", "task", "completed", "done", live = false),
        )
        val snapshot = listOf(SubagentChip("live", "scout", "running", "now", live = true))
        val merged = reconcileSubagentChips(previous, snapshot)
        // Retention/status are the contract; merge order is incidental LinkedHashMap
        // insertion, not a documented roster order.
        assertEquals(setOf("live", "old"), merged.map { it.id }.toSet())
        assertEquals(2, merged.size)
        assertEquals("running", merged.first { it.id == "live" }.status)
        assertTrue(merged.first { it.id == "live" }.live)
        assertEquals("completed", merged.first { it.id == "old" }.status)
    }

    @Test
    fun terminalHistorySettlesLiveStartedWithoutResurrectingNonTerminal() {
        val live = listOf(SubagentChip("s1", "scout", "running", "now", live = true))
        val history = listOf(
            SubagentChip("s1", "scout", "completed", "done", live = false),
            SubagentChip("ghost", "task", "unknown", "stale", live = false),
        )
        val merged = mergeSubagentChips(live, history)
        assertEquals("completed", merged.first { it.id == "s1" }.status)
        assertFalse(merged.first { it.id == "s1" }.live)
        assertFalse(merged.first { it.id == "ghost" }.live)
        assertEquals(0, merged.count(::isSubagentLive))
    }

    @Test
    fun resultOnlyRowsPreserveTerminalEvidenceAndRejectInvalidExitCodes() {
        val chips = parseSubagentChips(JSONArray("""[
            {"id":"done","result":{"status":"completed"}},
            {"id":"failed","status":"started","result":{"exitCode":1}},
            {"id":"abort","result":{"aborted":true,"exitCode":0}},
            {"id":"unavailable","result":{"exitCode":"invalid","error":null}}
        ]"""), live = false)
        assertEquals(listOf("completed", "failed", "aborted", "unknown"), chips.map { it.status })
        assertEquals(0, chips.count(::isSubagentLive))
        val refreshed = mergeSubagentChips(chips, parseSubagentChips(
            JSONArray("""[{"id":"done","status":"started"}]"""), live = false,
        ))
        assertEquals("completed", refreshed.first { it.id == "done" }.status)
    }

    @Test
    fun snapshotCannotUndoNewerTerminalButLaterAuthoritativeSnapshotCanRevive() {
        val requested = listOf(SubagentChip("s1", "task", "running", "work", live = true))
        val finished = EventProjector.applySubagentEvent(requested,
            JSONObject("""{"type":"subagent_lifecycle","id":"s1","status":"completed"}"""),
        )!!
        val hydrated = reconcileSubagentChips(finished, requested, atRequest = requested)
        assertEquals("completed", hydrated.single().status)
        assertEquals(0, hydrated.count(::isSubagentLive))
        val restarted = reconcileSubagentChips(hydrated, requested, atRequest = hydrated)
        assertEquals("running", restarted.single().status)
        assertEquals(1, restarted.count(::isSubagentLive))
    }

    @Test
    fun resultProgressSettlesAndOnlyExplicitLifecycleStartRevives() {
        val completed = EventProjector.applySubagentEvent(emptyList(),
            JSONObject("""{"type":"subagent_progress","progress":{"id":"s1","status":"running","result":{"status":"failed"}}}"""),
        )!!
        assertEquals("failed", completed.single().status)
        val stale = EventProjector.applySubagentEvent(completed,
            JSONObject("""{"type":"subagent_progress","progress":{"id":"s1","status":"running"}}"""),
        )!!
        assertEquals("failed", stale.single().status)
        assertEquals(0, stale.count(::isSubagentLive))
        val restarted = EventProjector.applySubagentEvent(stale,
            JSONObject("""{"type":"subagent_lifecycle","id":"s1","status":"started"}"""),
        )!!
        assertEquals("running", restarted.single().status)
        assertEquals(1, restarted.count(::isSubagentLive))
    }

    @Test
    fun eventProjectorUpsertsLifecycleAndProgressAsLive() {
        val started = EventProjector.applySubagentEvent(
            emptyList(),
            JSONObject().put("type", "subagent_lifecycle").put("id", "s1").put("agent", "scout").put("status", "started"),
        )!!
        assertEquals("running", started.single().status)
        assertTrue(started.single().live)

        val progressed = EventProjector.applySubagentEvent(
            started,
            JSONObject()
                .put("type", "subagent_progress")
                .put("progress", JSONObject().put("id", "s1").put("status", "completed").put("task", "done")),
        )!!
        assertEquals("completed", progressed.single().status)
        assertFalse(progressed.single().live)
        assertEquals("done", progressed.single().task)
        assertNull(EventProjector.applySubagentEvent(progressed, JSONObject().put("type", "message_end")))
    }
}
