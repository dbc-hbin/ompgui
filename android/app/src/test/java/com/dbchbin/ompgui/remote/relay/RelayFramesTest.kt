package com.dbchbin.ompgui.remote.relay

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RelayFramesTest {
    @Test
    fun encodesPairingHelloWithoutNullFields() {
        val encoded = ClientFrame.Hello(
            pairingSecret = "c".repeat(43),
            label = "Pixel",
        ).encode()
        val json = JSONObject(encoded)
        assertEquals("hello", json.getString("op"))
        assertEquals(1, json.getInt("protocol"))
        assertEquals("c".repeat(43), json.getString("pairingSecret"))
        assertEquals("Pixel", json.getString("label"))
        assertFalse(json.has("deviceId"))
        assertFalse(json.has("images"))
    }

    @Test
    fun encodesDeviceHello() {
        val encoded = ClientFrame.Hello(
            deviceId = "d_abcdefghijklmnopqr",
            token = "b".repeat(43),
        ).encode()
        val json = JSONObject(encoded)
        assertEquals("d_abcdefghijklmnopqr", json.getString("deviceId"))
        assertEquals("b".repeat(43), json.getString("token"))
        assertFalse(json.has("pairingSecret"))
    }

    @Test
    fun encodesPromptWithoutImages() {
        val encoded = ClientFrame.Cmd(req = 7, type = "prompt", message = "hi").encode()
        val json = JSONObject(encoded)
        assertEquals("cmd", json.getString("op"))
        assertEquals("prompt", json.getString("type"))
        assertEquals("hi", json.getString("message"))
        assertFalse(json.has("images"))
    }

    @Test
    fun parsesHelloOkSessionsAndSnapshot() {
        val hello = parseServerFrame(
            """{"op":"hello_ok","protocol":1,"serverId":"s_1","deviceId":"d_phone","token":"new-token-value-0123456789abcdefghijk"}""",
        ) as ServerFrame.HelloOk
        assertEquals("s_1", hello.serverId)
        assertEquals("d_phone", hello.deviceId)
        assertEquals("new-token-value-0123456789abcdefghijk", hello.token)

        val sessions = parseServerFrame(
            """{"op":"sessions","sessions":[{"id":"sess-1","cwd":"/tmp","firstMessage":"hi"}],"runningIds":["sess-1"]}""",
        ) as ServerFrame.Sessions
        assertEquals("sess-1", sessions.sessions[0].id)
        assertEquals(listOf("sess-1"), sessions.runningIds)

        val snapshot = parseServerFrame(
            """{"op":"session.snapshot","id":"sess-1","title":"Demo","messages":[{"role":"user","text":"hi"},{"role":"tool","text":"nope"}],"agent":{"running":false,"ready":true}}""",
        ) as ServerFrame.Snapshot
        assertEquals("Demo", snapshot.title)
        assertEquals(1, snapshot.messages.size)
        assertEquals("user", snapshot.messages[0].role)
        assertTrue(snapshot.agent.ready)
    }

    @Test
    fun rejectsUnknownOpsAndOversize() {
        assertNull(parseServerFrame("""{"op":"explode"}"""))
        assertNull(parseServerFrame("{"))
        assertNotNull(parseServerFrame("""{"op":"error","code":"x","message":"y"}"""))
    }

    @Test
    fun encodesModelsListWithoutFields() {
        val json = JSONObject(ClientFrame.ModelsList.encode())
        assertEquals("models.list", json.getString("op"))
        assertEquals(1, json.length())
    }

    @Test
    fun parsesModelsListSkippingBadEntries() {
        val frame = parseServerFrame(
            """{"op":"models","models":[{"provider":"openai","id":"gpt-5","name":"GPT-5"},{"provider":"anthropic","id":"sonnet"},{"provider":"","id":"x"},{"id":"y"}]}""",
        ) as ServerFrame.Models
        assertEquals(2, frame.models.size)
        assertEquals("GPT-5", frame.models[0].name)
        // name falls back to id when the Mac omits it
        assertEquals("sonnet", frame.models[1].name)
    }

    @Test
    fun parsesSnapshotModelFromAgentState() {
        val frame = parseServerFrame(
            """{"op":"session.snapshot","id":"sess-1","messages":[],"agent":{"running":false,"ready":true,"state":{"model":{"provider":"openai","id":"gpt-5","name":"GPT-5"}}}}""",
        ) as ServerFrame.Snapshot
        assertEquals("openai", frame.agent.model?.provider)
        assertEquals("gpt-5", frame.agent.model?.id)
        assertEquals("GPT-5", frame.agent.model?.displayName())

        val bare = parseServerFrame(
            """{"op":"session.snapshot","id":"sess-1","messages":[],"agent":{"running":false,"ready":true}}""",
        ) as ServerFrame.Snapshot
        assertNull(bare.agent.model)
    }

    @Test
    fun parsesCmdOkDataModel() {
        val getState = parseServerFrame(
            """{"op":"cmd_ok","req":3,"data":{"model":{"provider":"openai","id":"gpt-5"},"thinkingLevel":"off"}}""",
        ) as ServerFrame.CmdOk
        assertEquals("gpt-5", getState.model()?.id)

        val setModel = parseServerFrame(
            """{"op":"cmd_ok","req":4,"data":{"provider":"anthropic","id":"sonnet"}}""",
        ) as ServerFrame.CmdOk
        assertEquals("anthropic", setModel.model()?.provider)

        val empty = parseServerFrame("""{"op":"cmd_ok","req":5}""") as ServerFrame.CmdOk
        assertNull(empty.model())
    }

    @Test
    fun parseModelRefAcceptsModelIdKey() {
        val ref = parseModelRef(JSONObject("""{"provider":"openai","modelId":"gpt-5"}"""))
        assertEquals("gpt-5", ref?.id)
        assertNull(parseModelRef(JSONObject("""{"running":true}""")))
    }
    @Test
    fun encodesSessionCreateAndNewCmds() {
        val created = JSONObject(
            ClientFrame.SessionCreate(
                cwd = "/tmp/proj",
                message = "hi",
                provider = "openai",
                modelId = "gpt",
                thinkingLevel = "high",
            ).encode(),
        )
        assertEquals("session.create", created.getString("op"))
        assertEquals("/tmp/proj", created.getString("cwd"))
        assertEquals("high", created.getString("thinkingLevel"))

        val thinking = JSONObject(
            ClientFrame.Cmd(req = 4, type = "set_thinking_level", level = "high").encode(),
        )
        assertEquals("set_thinking_level", thinking.getString("type"))
        assertEquals("high", thinking.getString("level"))

        val compact = JSONObject(ClientFrame.Cmd(req = 5, type = "compact").encode())
        assertEquals("compact", compact.getString("type"))
    }

    @Test
    fun parsesProjectsFilesSlashAndCmdOkArray() {
        val projects = parseServerFrame(
            """{"op":"projects","projects":[{"path":"/tmp/proj","name":"proj"}]}""",
        ) as ServerFrame.Projects
        assertEquals("proj", projects.projects[0].name)

        val files = parseServerFrame(
            """{"op":"files","path":"/tmp/proj","entries":[{"name":"README.md","path":"/tmp/proj/README.md","dir":false}]}""",
        ) as ServerFrame.Files
        assertEquals("README.md", files.entries[0].name)

        val slash = parseServerFrame(
            """{"op":"slash","commands":[{"name":"plan","requiresArgs":true,"hint":"plan"}]}""",
        ) as ServerFrame.Slash
        assertEquals("plan", slash.commands[0].name)
        assertTrue(slash.commands[0].requiresArgs)

        val cmdOk = parseServerFrame(
            """{"op":"cmd_ok","req":9,"data":[{"id":"a1","agent":"explore","status":"running","task":"look"}]}""",
        ) as ServerFrame.CmdOk
        val chips = parseSubagentChips(cmdOk.data?.optJSONArray("items"))
        assertEquals("explore", chips[0].agent)

        val phases = parseTodoPhases(
            org.json.JSONArray("""[{"name":"Build","tasks":[{"content":"Ship","status":"completed"}]}]"""),
        )
        assertEquals("Build", phases[0].name)
        assertEquals("completed", phases[0].tasks[0].status)
    }
    @Test
    fun encodesAndParsesFileAndSessionLifecycleFrames() {
        val read = JSONObject(ClientFrame.FilesRead("/tmp/proj/README.md").encode())
        assertEquals("files.read", read.getString("op"))
        assertEquals("/tmp/proj/README.md", read.getString("path"))

        val deleted = parseServerFrame("""{"op":"session.deleted","id":"sess-1"}""") as ServerFrame.SessionDeleted
        assertEquals("sess-1", deleted.id)

        val file = parseServerFrame(
            """{"op":"file","path":"/tmp/a.ts","name":"a.ts","text":"hi","encoding":"utf8"}""",
        ) as ServerFrame.FileContent
        assertEquals("a.ts", file.file.name)
        assertEquals("hi", file.file.text)

        val trees = parseServerFrame(
            """{"op":"worktrees","cwd":"/tmp/proj","projectRoot":"/tmp/proj","isGit":true,"worktrees":[{"path":"/tmp/proj","branch":"main","isMain":true}]}""",
        ) as ServerFrame.Worktrees
        assertEquals("main", trees.worktrees[0].branch)
    }

    @Test
    fun encodesFilesWriteGitBranchesSkillsMcpAndExport() {
        val write = JSONObject(ClientFrame.FilesWrite("/tmp/proj/a.ts", "hi").encode())
        assertEquals("files.write", write.getString("op"))
        assertEquals("/tmp/proj/a.ts", write.getString("path"))
        assertEquals("hi", write.getString("text"))

        val status = JSONObject(ClientFrame.GitStatus("/tmp/proj").encode())
        assertEquals("git.status", status.getString("op"))
        assertEquals("/tmp/proj", status.getString("cwd"))

        val diff = JSONObject(ClientFrame.GitDiff("/tmp/proj", "a.ts").encode())
        assertEquals("git.diff", diff.getString("op"))
        assertEquals("/tmp/proj", diff.getString("cwd"))
        assertEquals("a.ts", diff.getString("path"))

        val branches = JSONObject(ClientFrame.SessionBranches("sess-1").encode())
        assertEquals("session.branches", branches.getString("op"))
        assertEquals("sess-1", branches.getString("id"))

        val leaf = JSONObject(ClientFrame.SessionLeaf("sess-1", "leaf-2").encode())
        assertEquals("session.leaf", leaf.getString("op"))
        assertEquals("leaf-2", leaf.getString("leafId"))

        val exported = JSONObject(ClientFrame.SessionExport("sess-1").encode())
        assertEquals("session.export", exported.getString("op"))

        val skills = JSONObject(ClientFrame.SkillsList("/tmp/proj").encode())
        assertEquals("skills.list", skills.getString("op"))

        val toggle = JSONObject(
            ClientFrame.SkillsToggle("/tmp/proj", "/tmp/proj/skills/a.md", true).encode(),
        )
        assertEquals("skills.toggle", toggle.getString("op"))
        assertTrue(toggle.getBoolean("disableModelInvocation"))

        val plugins = JSONObject(ClientFrame.PluginsList("/tmp/proj").encode())
        assertEquals("plugins.list", plugins.getString("op"))

        val action = JSONObject(
            ClientFrame.PluginsAction("/tmp/proj", "install", "owner/repo", "project").encode(),
        )
        assertEquals("plugins.action", action.getString("op"))
        assertEquals("install", action.getString("action"))

        val mcpList = JSONObject(ClientFrame.McpList(null).encode())
        assertEquals("mcp.list", mcpList.getString("op"))
        assertFalse(mcpList.has("cwd"))

        val mcpUpsert = JSONObject(
            ClientFrame.McpUpsert("/tmp/proj", "gh", "http", null, "https://mcp.example", null).encode(),
        )
        assertEquals("mcp.upsert", mcpUpsert.getString("op"))
        assertEquals("http", mcpUpsert.getString("type"))

        val mcpDelete = JSONObject(ClientFrame.McpDelete("/tmp/proj", "gh").encode())
        assertEquals("mcp.delete", mcpDelete.getString("op"))

        // Server side: all contract ops parse to non-null frames.
        val written = parseServerFrame(
            """{"op":"file.written","path":"/tmp/proj/a.ts","bytes":2}""",
        ) as ServerFrame.FileWritten
        assertEquals("/tmp/proj/a.ts", written.path)
        assertEquals(2L, written.bytes)

        val gitStatus = parseServerFrame(
            """{"op":"git.status","cwd":"/tmp/proj","isGitRepository":true,"repositoryRoot":"/tmp/proj","files":[{"filePath":"a.ts","status":"modified","code":"M"}]}""",
        ) as ServerFrame.GitStatusResult
        assertTrue(gitStatus.isGitRepository)
        assertEquals("a.ts", gitStatus.files[0].filePath)
        assertEquals("M", gitStatus.files[0].code)

        val gitDiff = parseServerFrame(
            """{"op":"git.diff","path":"a.ts","supported":true,"status":"modified","patch":"diff","truncated":false}""",
        ) as ServerFrame.GitDiffResult
        assertEquals("a.ts", gitDiff.diff.path)
        assertTrue(gitDiff.diff.supported)

        val branchFrame = parseServerFrame(
            """{"op":"branches","id":"sess-1","leafId":"leaf-2","branches":[{"id":"leaf-2","label":"Second"}]}""",
        ) as ServerFrame.Branches
        assertEquals("leaf-2", branchFrame.leafId)
        assertEquals("Second", branchFrame.branches[0].label)

        val skillsFrame = parseServerFrame(
            """{"op":"skills","cwd":"/tmp/proj","skills":[{"name":"plan","description":"d","filePath":"/tmp/s.md","disableModelInvocation":false}]}""",
        ) as ServerFrame.Skills
        assertEquals("plan", skillsFrame.skills[0].name)

        val skillUpdated = parseServerFrame(
            """{"op":"skill.updated","filePath":"/tmp/s.md","disableModelInvocation":true}""",
        ) as ServerFrame.SkillUpdated
        assertTrue(skillUpdated.disableModelInvocation)

        val pluginsFrame = parseServerFrame(
            """{"op":"plugins","cwd":"/tmp/proj","packages":[{"source":"owner/repo","scope":"project","status":"installed","disabled":false}]}""",
        ) as ServerFrame.Plugins
        assertEquals("owner/repo", pluginsFrame.packages[0].source)

        val mcpFrame = parseServerFrame(
            """{"op":"mcp","inventory":[{"name":"gh","source":"project","status":"connected","type":"http","enabled":true}]}""",
        ) as ServerFrame.Mcp
        assertEquals("gh", mcpFrame.inventory[0].name)

        val mcpUpserted = parseServerFrame("""{"op":"mcp.upserted","name":"gh"}""") as ServerFrame.McpUpserted
        assertEquals("gh", mcpUpserted.name)

        val mcpDeleted = parseServerFrame("""{"op":"mcp.deleted","name":"gh"}""") as ServerFrame.McpDeleted
        assertEquals("gh", mcpDeleted.name)

        val sessionExported = parseServerFrame(
            """{"op":"session.exported","id":"sess-1","fileName":"sess-1.html","bytes":10,"html":"<h1>hi</h1>"}""",
        ) as ServerFrame.SessionExported
        assertEquals("sess-1.html", sessionExported.export.fileName)
        assertEquals("<h1>hi</h1>", sessionExported.export.html)
    }

    @Test
    fun encodesAndParsesSessionImportSkillsAgentsFilesAuthProjects() {
        val import = JSONObject(ClientFrame.SessionImport("chat.json", "{}").encode())
        assertEquals("session.import", import.getString("op"))
        assertEquals("chat.json", import.getString("fileName"))
        assertEquals("{}", import.getString("content"))
        val imported = parseServerFrame(
            """{"op":"session.imported","id":"sess-9","cwd":"/tmp/proj"}""",
        ) as ServerFrame.SessionImported
        assertEquals("sess-9", imported.id)
        assertEquals("/tmp/proj", imported.cwd)

        val search = JSONObject(ClientFrame.SkillsSearch("plan", 5).encode())
        assertEquals("skills.search", search.getString("op"))
        assertEquals("plan", search.getString("query"))
        assertEquals(5, search.getInt("limit"))
        val results = parseServerFrame(
            """{"op":"skill.results","query":"plan","results":[{"package":"owner/plan","installs":"100","url":"https://example.com"}]}""",
        ) as ServerFrame.SkillResults
        assertEquals("plan", results.query)
        assertEquals("owner/plan", results.results[0].packageName)

        val install = JSONObject(ClientFrame.SkillsInstall("owner/plan", "project", "/tmp/proj").encode())
        assertEquals("skills.install", install.getString("op"))
        assertEquals("owner/plan", install.getString("package"))
        assertEquals("project", install.getString("scope"))
        val installed = parseServerFrame(
            """{"op":"skill.installed","package":"owner/plan","scope":"project"}""",
        ) as ServerFrame.SkillInstalled
        assertEquals("owner/plan", installed.pkg)

        val agentsList = JSONObject(ClientFrame.AgentsList("/tmp/proj").encode())
        assertEquals("agents.list", agentsList.getString("op"))
        assertEquals("/tmp/proj", agentsList.getString("cwd"))
        val agents = parseServerFrame(
            """{"op":"agents","cwd":"/tmp/proj","agents":[{"name":"explore","description":"d","source":"user"}]}""",
        ) as ServerFrame.Agents
        assertEquals("explore", agents.agents[0].name)

        val save = JSONObject(
            ClientFrame.AgentsSave("explore", "d", "prompt", "user", "/tmp/proj").encode(),
        )
        assertEquals("agents.save", save.getString("op"))
        assertEquals("explore", save.getString("name"))
        assertEquals("prompt", save.getString("systemPrompt"))
        val saved = parseServerFrame(
            """{"op":"agent.saved","name":"explore","filePath":"/tmp/agents/explore.md"}""",
        ) as ServerFrame.AgentSaved
        assertEquals("explore", saved.name)

        val delete = JSONObject(ClientFrame.AgentsDelete("explore", "user", null).encode())
        assertEquals("agents.delete", delete.getString("op"))
        assertFalse(delete.has("cwd"))
        val deletedAgent = parseServerFrame("""{"op":"agent.deleted","name":"explore"}""") as ServerFrame.AgentDeleted
        assertEquals("explore", deletedAgent.name)

        val providersOut = JSONObject(ClientFrame.AuthProviders.encode())
        assertEquals("auth.providers", providersOut.getString("op"))
        val providers = parseServerFrame(
            """{"op":"auth.providers","providers":[{"id":"openai","name":"OpenAI","loggedIn":true}]}""",
        ) as ServerFrame.AuthProvidersResult
        assertEquals("openai", providers.providers[0].id)
        assertTrue(providers.providers[0].loggedIn)

        val index = JSONObject(ClientFrame.FilesIndex("/tmp/proj", "read").encode())
        assertEquals("files.index", index.getString("op"))
        assertEquals("/tmp/proj", index.getString("cwd"))
        assertEquals("read", index.getString("query"))
        val matches = parseServerFrame(
            """{"op":"files.index","cwd":"/tmp/proj","query":"read","matches":[{"path":"/tmp/proj/README.md","isDir":false}]}""",
        ) as ServerFrame.FilesIndexResult
        assertEquals("/tmp/proj/README.md", matches.matches[0].path)

        val add = JSONObject(ClientFrame.ProjectsAdd("/tmp/proj").encode())
        assertEquals("projects.add", add.getString("op"))
        assertEquals("/tmp/proj", add.getString("cwd"))
        val added = parseServerFrame(
            """{"op":"project.added","path":"/tmp/proj","name":"proj"}""",
        ) as ServerFrame.ProjectAdded
        assertEquals("/tmp/proj", added.path)

        val remove = JSONObject(ClientFrame.ProjectsRemove("/tmp/proj").encode())
        assertEquals("projects.remove", remove.getString("op"))
        val removed = parseServerFrame(
            """{"op":"project.removed","path":"/tmp/proj"}""",
        ) as ServerFrame.ProjectRemoved
        assertEquals("/tmp/proj", removed.path)
    }
}
