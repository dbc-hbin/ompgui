package com.dbchbin.ompgui.remote.ui

import com.dbchbin.ompgui.remote.relay.RelayArchive
import org.junit.Assert.assertEquals
import org.junit.Test

class ArchiveSearchTest {
    @Test
    fun unnamedArchivesMatchIdsKeysAndPathsWithoutMatchingAbsentNames() {
        val byId = RelayArchive(key = "first", id = "SESSION-42")
        val byKey = RelayArchive(key = "backup-42")
        val byPath = RelayArchive(key = "third", cwd = "/Users/Work/Project-42")
        val archives = listOf(byPath, byId, byKey, RelayArchive(key = "other"))

        assertEquals(listOf(byId), filterArchives(archives, " session-42 "))
        assertEquals(listOf(byKey), filterArchives(archives, "BACKUP"))
        assertEquals(listOf(byPath), filterArchives(archives, "/work/project"))
        assertEquals(listOf(byPath, byId, byKey), filterArchives(archives, "42"))
        assertEquals(emptyList<RelayArchive>(), filterArchives(archives, "null"))
        assertEquals(archives, filterArchives(archives, "  "))
    }

    @Test
    fun matchesUnicodeNamesCaseInsensitivelyWithoutIncludingUnrelatedArchives() {
        val named = RelayArchive(key = "first", name = "ÉTUDE 프로젝트")
        val other = RelayArchive(key = "second", name = "Unrelated")
        val archives = listOf(named, other)

        assertEquals(listOf(named), filterArchives(archives, "étude"))
        assertEquals(listOf(named), filterArchives(archives, "프로젝트"))
        assertEquals(emptyList<RelayArchive>(), filterArchives(archives, "missing"))
    }
}
