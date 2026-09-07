import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { addWorktree, listWorktrees, removeWorktree, resolveAllowedWorktreeListing, resolveProject } = await jiti.import("./worktree.ts");

test("removed worktree recovery rejects arbitrary missing paths and symlink escapes", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omp-worktree-access-")));
  const repo = join(root, "repo");
  const outside = join(root, "outside");
  try {
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(join(outside, ".git"), { recursive: true });
    mkdirSync(`${outside}-worktrees`);
    const roots = new Set([repo]);
    assert.equal(await resolveAllowedWorktreeListing(join(repo, "missing"), roots), null);
    assert.equal(await resolveAllowedWorktreeListing(join(`${outside}-worktrees`, "gone"), roots), null);
    symlinkSync(`${outside}-worktrees`, `${repo}-worktrees`, "dir");
    assert.equal(await resolveAllowedWorktreeListing(join(`${repo}-worktrees`, "gone"), roots), null);
    symlinkSync(outside, join(repo, "escape"), "dir");
    assert.equal(await resolveAllowedWorktreeListing(join(repo, "escape"), roots), null);
    symlinkSync(join(root, "absent"), join(repo, "dangling-worktrees"), "dir");
    assert.equal(await resolveAllowedWorktreeListing(join(repo, "dangling-worktrees", "gone"), roots), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

test("discovers the main checkout and linked worktrees without retaining prunable paths", async (t) => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
  } catch {
    t.skip("git is not installed");
    return;
  }

  const root = realpathSync(mkdtempSync(join(tmpdir(), "omp-web-worktree-test-")));
  const repo = join(root, "repo");
  const worktreeBase = `${repo}-worktrees`;
  try {
    git(root, ["init", repo]);
    git(repo, ["config", "user.email", "omp-web@example.invalid"]);
    git(repo, ["config", "user.name", "omp-web test"]);
    writeFileSync(join(repo, "README.md"), "fixture\n");
    git(repo, ["add", "README.md"]);
    git(repo, ["commit", "-m", "fixture"]);

    const main = await resolveProject(repo);
    assert.equal(main.projectRoot, repo);
    assert.equal(main.isWorktree, false);
    assert.equal(main.isTopLevel, true);
    assert.ok(main.branch);

    const created = await addWorktree(repo, "feature/test");
    assert.equal(created.branch, "feature/test");
    assert.equal(existsSync(created.path), true);

    const worktrees = await listWorktrees(repo);
    assert.equal(worktrees.length, 2);
    assert.equal(worktrees[0].isMain, true);
    assert.ok(worktrees.some((entry) => entry.path === created.path && entry.branch === "feature/test"));

    const linked = await resolveProject(created.path);
    assert.equal(linked.projectRoot, repo);
    assert.equal(linked.isWorktree, true);
    assert.equal(linked.branch, "feature/test");

    await removeWorktree(repo, created.path, true);
    assert.equal(existsSync(created.path), false);
    const recovered = await resolveAllowedWorktreeListing(created.path, new Set([repo]));
    assert.equal(recovered.project.projectRoot, repo);
    assert.deepEqual(await listWorktrees(recovered.listingCwd), [{ path: repo, branch: main.branch, isMain: true }]);
    assert.equal(await resolveAllowedWorktreeListing(created.path, new Set([created.path])), null);
  } finally {
    rmSync(worktreeBase, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
