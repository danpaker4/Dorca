# Dorca native blame and released upstream integration

Implementation branch: `feat/dorca-native-blame`. The initial handoff contained source work and local `--mode e2e` validation only. Windows release preparation is recorded in [Dorca 2.0.13](../releases/dorca-2.0.13.md). The user's running application is not replaced by release preparation or publication.

## Released upstream baseline

GitHub's official release API verified **v1.4.261**, published **2026-11-16T10:30:50Z**, as the newest stable release. Its annotated tag peels to **92d4266cc4ffa945dbc1fa52850e62448d2dfc1c**. Release: <https://github.com/stablyai/orca/releases/tag/v1.4.261>.

The handoff recorded v1.4.258 at **c91a7a6ee3dc76090cafb33943961ae2235246d6**. `git rev-list --count c91a7a6ee3dc76090cafb33943961ae2235246d6..92d4266cc4ffa945dbc1fa52850e62448d2dfc1c` reports **888 commits**. This comparison uses Dorca's recorded upstream baseline because its sync convention applies release patches rather than merging upstream ancestry.

Applied the released source deltas with the existing `dorca-upstream-integration.mjs` three-way patch convention. Upstream main was not incorporated. Resolved branding, mobile identity, launcher, updater, settings and Monaco setup conflicts deliberately. Kept Dorca's updater pointed at `danpaker4/Dorca`, its mobile identifiers, native TypeScript navigation and other customizations. Updated moved imports and narrowly repaired CI source/test references; retained Dorca's workflow structure. Retired duplicate upstream test paths and retained Dorca's extended editor-owner coverage at the new location. `config/dorca-release.json` records the incorporated upstream commit; Dorca's version remains **2.0.12**.

## Implemented behavior

- Current-line blame by default, with Off / Current line / Whole file in editor settings. Visible-line overlays show author, relative age and summary without inserting or wrapping source text.
- Hover or tap opens author/avatar, relative and exact time, full commit message, committer, parent and a removed/added preview. Working-tree lines show uncommitted state; available file modification time or buffer-edit time supplies their timestamp.
- Hashes open commit comparisons. Copy hash/message, open revision, compare with the current buffer, previous/next relevant line revision and Explain use existing clipboard, diff and agent-picker flows. Explain carries the displayed diff, path, revision, parent and author context; it does not automatically send a message.
- Commands: `Git: Toggle File Blame` (`Ctrl/Cmd+Alt+B`), `Git: Show Line History` (`Alt+F8`), and the existing `Peek Git Change` (`Alt+F7`). They are available through Monaco's command/context access.
- Deletions use a small red triangle at the gap, including beginning/end-of-file and multiline deletions. Each marker opens its own deleted-lines comparison.
- Inline peeks retain full original/modified models. Vertical and horizontal scrolling stay inside the peek; opening reveals the selected change. Previous/next, current/total and highlighting move together while the peek remains anchored to its opening marker.
- Working-tree diff models reuse Dorca's TypeScript workspace service and normal editor opener. F12, Ctrl/Cmd+click and context-menu Go to Definition open the target file/range with Back navigation, preserving the source diff. This covers inline peeks and full side-by-side/inline diffs.

## Correctness and limits

Git work executes through runtime host routing and existing Git process wrappers. Folder workspaces discover the file's actual repository, including nested repositories. Attribution projects immutable revision content onto the supplied buffer; added/replaced spans are uncommitted. Model/version guards clear annotations immediately on edits and reject stale results. Superseding requests cancel Git work. Immutable blame/content caches and request channels are bounded; reads use background admission, timeouts and remote payload limits. Files above 1 MiB or 20,000 lines report that blame is unavailable.

Historical and staged definition navigation is explicitly unavailable: Dorca's current language service resolves working-tree projects. Old/deleted inline rows never silently resolve against current declarations. The comparison remains intact and shows this limitation. In folder workspaces, clicking a commit opens the selected file's commit comparison; ordinary worktrees use the existing all-files commit view. Avatars use GitHub's numeric noreply identity when present, with an author-initial fallback.

Windows local and paired-runtime flows were exercised. macOS, Linux and actual SSH hosts were not executed locally. The required Electron skill was absent after searching the available catalog, local skill directories and repository; rendered checks used the repository's hidden Electron Playwright/CDP harness. Every launched test app used `ORCA_BACKGROUND_LAUNCH=1`, and rendered tests assert that no BrowserWindow is visible.

## Validation evidence

- `pnpm tc`: all five projects pass after the final implementation edits.
- Focused owning-layer Vitest run: **39 tests in 6 files pass**, including real Git blame/rename/root/unborn/deleted-path/nested-repository cases, inserted lines without predecessors, real Git inline operations, workspace navigation/opener/buffer precedence and editor-owner migration. Dorca's release-plan and upstream-patch fixture tests add **10 passing checks** without building or publishing a release.
- Hidden rendered checks pass in scoped runs: `diff-definition-navigation.spec.ts`, all three `git-blame-editor.spec.ts` cases, and both `inline-git-change-peek.spec.ts` cases. They cover imported definitions, both full diff modes, context menu/modified click, Back, blame history/comparison/Explain picker, full-file scrolling, deletion gaps, staging/reverting/undo and a paired owning runtime. Narrow checks open history from Off and verify reachable actions after the hover is constrained to the editor's available space.
- Presentational blame-card fixtures were captured at 480 and 320 pixels in light/dark themes. Actual editor checks use 1280×900 and 720×800 viewports.
- Scoped code-quality scans cover Dorca's changes relative to the released source, with added-line accounting against `origin/main`. Moved existing code is compared to its original baseline. Formatting, source-path references, generated RPC catalog, localization and test-runner ownership are checked separately.

The broad local `origin/main` changed gate includes the large upstream reorganization and is not represented as a completely green full-repository run. The standard local `pnpm test` preflight also attempts to compile upstream's new Windows notifications addon; this machine lacks Python for node-gyp. The focused tests use the repository's Vitest execution wrapper directly and do not exercise that addon. Earlier rendered attempts encountered Windows temporary-profile cleanup EPERM failures; subsequent scoped rendered runs passed, including paired staging. No hooks were bypassed. Hosted Windows release validation runs separately.
