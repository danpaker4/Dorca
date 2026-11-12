# Dorca CLI and symbol navigation fixes

## Preserved baseline

The initial checkout, `450978496c5`, matched `origin/main` and the main checkout, but did not contain the completed inline Git peek work. That work and the Orca v1.4.255 integration were in `danpaker4/inline-git-change-peek`.

This branch now includes integration commit `6b91052efbe` and an exact snapshot of that worktree's tracked staged and unstaged changes in `f3164ec88e0`. The original worktree was not changed. Its existing release metadata and workflow follow-ups were preserved, including the check that refuses publication when a newer stable upstream release exists. No release preparation, build, installer, tag, push, or publication was performed for these fixes.

## Windows CLI

The installed launcher reproduced:

```text
Unable to locate Orca.exe next to "C:\Users\dpake\AppData\Local\Programs\dorca\resources"
```

The Rust launcher fixed the executable name to `Orca.exe`, whereas Windows packaging specifies `Dorca.exe`. The native build now derives the embedded filename from `win.executableName` (or `productName`) in the actual electron-builder configuration. That configuration participates in the build fingerprint, and Cargo watches the new identity variable. Direct upstream compilation still defaults to `Orca.exe`.

Resolution remains relative to the launcher's own installation. A Dorca launcher never searches PATH or falls back to another Orca executable. Server configuration is still checked first and selects its configured Node, CLI, and profile independently of desktop branding.

The native build previously assigned a current source fingerprint to an installed helper copied into a fresh checkout. This could silently reuse the broken installed launcher after a source change. Unverified binaries now require compilation.

The Windows command shim delegates to this native launcher. CLI child-process and WSL installation paths already use the resolved executable or launcher path. Linux's launcher matches its `orca-ide` packaging name. The macOS launcher had the equivalent fixed `Contents/MacOS/Orca` assumption; it now reads `CFBundleExecutable` from its own bundle, retaining the upstream synthetic layout fallback when no plist exists.

## Symbol navigation

Both affected paths were Dorca's JavaScript/TypeScript provider wrappers:

- Go to Definition, including Ctrl-click, used a repository word search for exported declarations after an unresolved worker request.
- Find References appended word-search matches directly, including unrelated declarations, strings, and inline comments. Loading a limited set of candidate models never semantically verified those matches.

The old import resolver also guessed source directories and aliases without reading project configuration. Its caches did not distinguish owning hosts.

Both wrappers now query Monaco's bundled TypeScript language service in a dedicated worker. It receives a workspace file inventory and loads requested snapshots through the existing runtime file clients. TypeScript parses tsconfig/jsconfig, configuration inheritance and project references, and performs module, alias, package, and reexport resolution. Only language-service locations are returned. Unresolved import aliases are not offered as target definitions. The heuristic import and text-search fallback modules were removed.

Open buffers and retained closed drafts override disk snapshots, including newly created files and unsaved import changes. Buffer versions and the editor's captured file-operation authority are checked during the request. Target previews retain the source owner URI. Folder workspaces use their existing editor operation context; mixed folders restrict project discovery to the owning child repository. Neither a missing owner nor a remote error authorizes a local read.

## Validation

All launches used `ORCA_BACKGROUND_LAUNCH=1`. No visible Dorca or Electron test window was opened.

- The unrelated `Server` regression was observed failing against the original definition provider before the fix.
- Six focused Vitest suites passed: 40 tests covering navigation, native fingerprint rejection, existing runtime reads/listing, editor host isolation, and preserved real-Git inline hunk behavior. Vitest was invoked directly because the standard test bootstrap attempted unavailable native-addon compilation.
- Navigation coverage includes unrelated exported classes, comments and strings, renamed imports, reexports, inherited path aliases, open and retained unsaved buffers, an SSH owner with a same-path local model, TSX, JSX, CommonJS, and NodeNext `.mts` resolution with Windows paths.
- A real headless Chromium worker check through Playwright returned the intended class definition and three actual alias references, excluding the unrelated `Server` module.
- `pnpm tc:web`, `pnpm tc:node`, and `pnpm tc:cli` passed.
- Scoped oxlint, oxfmt, Rust formatting, changed-code quality, and the flaky-test ratchet passed. Quality checks use `f3164ec88e0` as the stacked base to avoid rescanning the preserved upstream integration.
- Windows x64 debug executables compiled directly from the Rust source with the installed MinGW compiler. The shared launcher regression fixture passed for both embedded `Dorca.exe` identity and upstream `Orca.exe` default: arguments, multiline bodies, inherited profile, exit codes, refusal to select the other executable, and server configuration precedence.
- macOS launcher shell syntax passed `bash -n`.

The focused regression command on Windows is:

```powershell
$env:ORCA_BACKGROUND_LAUNCH='1'
pnpm exec vitest run --config config/vitest.config.ts src/renderer/src/components/editor/monaco-ts-workspace-navigation.test.ts config/scripts/native-build/windows/windows-rust-executable-cache.test.mjs --maxWorkers=2
```

The native executable contract is shared by `build-windows-cli-launcher.test.mjs` and the debug smoke invocation. It can validate an already compiled debug launcher without running the optimized build suite:

```powershell
node --input-type=module -e "import { verifyWindowsCliResolution } from './config/scripts/native-build/windows/windows-cli-resolution-test-fixture.mjs'; verifyWindowsCliResolution('native/windows-cli-launcher/target/debug/dorca-cli-smoke.exe','Dorca.exe')"
```

## Limits

- This fixes the existing JavaScript/TypeScript navigation paths, including JSX and TSX parsing. It does not install language servers for Python, Go, C#, Java, or other languages.
- Worker fallback references cover the selected configured project and its imported dependency graph. They are not a tsserver solution-wide search through every separately configured consuming project. Project references select the configuration owning the source file.
- Without configuration, worker fallback files are treated as modules to avoid conflating unrelated script globals. Cross-file ambient script globals need a project configuration.
- The worker fallback does not load files, extended configurations, or definitions outside the owning workspace/child root. Ignored files absent from inventory and older remote hosts with bounded inventories can limit reference completeness.
- Worker discovery is bounded to 100,000 inventory entries, 100,000 loaded source files, 1,000,000 resolution paths, and 128 MiB of UTF-16 snapshots. Exhaustion, cancellation, owner changes, and errors return no locations. Its cold queries still load project data; it is not a persistent background index.
- Windows MSVC/ARM64 packaging, macOS execution, and a full Electron interaction run were not performed. The available MSVC setup lacked `link.exe`; debug validation used MinGW instead. The existing optimized native-build test suite and release builds were not invoked.
- The installed application and launcher remain unchanged. These source fixes are ready for review and later inclusion in a release that incorporates the then-current stable upstream Orca.

## Large-project reference follow-up

The renderer project's reference query reproduced an empty result after the original 64 MiB snapshot budget was exhausted. Increasing the budget alone exposed a second failure: constructing a complete program for the entire project could exhaust the worker heap.

Reference discovery now searches the owning host for candidate files and expands that set using the import and reexport aliases reported by TypeScript. Open and retained buffers participate independently of disk search. TypeScript verifies every returned location; text matches never become reference locations. Declaration files retain their project context, and configured ambient script queries retain the full configured project. Unsupported or truncated candidate searches fall back to the configured-project scan within the resource bounds above.

File-existence probes are separate from source snapshots and use the existing batched runtime API. Missing module guesses no longer count as loaded source files. Discovery respects TypeScript's default exclusion of JavaScript implementation files under node_modules and loads type-reference directives before building the language-service program. Inventory, import scans, completed module resolutions, candidate searches, and the completed language service are reused while the owning session remains current.

Both new size regressions returned no references against the original implementation and pass with the fix. Coverage also exercises renamed reexport chains, unrelated same-name symbols, configured script globals, and SSH-owned unsaved buffers.

A temporary, in-process diagnostic against this checkout returned the five expected references to `registerWorkspaceDefinitions`. Its cold scan completed in approximately 36 seconds; the repeated query completed in approximately 0.29 seconds. These are diagnostic measurements, not Electron interaction timings or test assertions. The diagnostic harness was removed. No installed application was rebuilt or replaced.

## Native TypeScript navigation

Configured projects now use Microsoft's native TypeScript 7 language server through its LSP interface. This is the same engine used by Microsoft's native TypeScript VS Code extension. Dorca keeps a server alive per owning client and workspace, prepares the project when a TypeScript editor opens, and shares its project state across definition and reference requests. The browser worker starts only when the native host is unavailable. Unconfigured reference searches retain the worker path so unopened consumers remain discoverable.

The native process runs on the filesystem-owning desktop or paired host. It receives open buffers and retained drafts, including unsaved imports, and closes overlays removed from the next captured request. Filesystem events update its project state. Authorization, captured environment pairing revisions, buffer versions, and logical owner paths remain enforced. The compiler resolves configured dependencies on its host, including external configuration dependencies; returned navigation targets stay within the owning root. SSH-backed desktop files and older hosts retain the existing worker fallback. The inventory and snapshot bounds above apply to that fallback, rather than the native server.

Desktop resources and paired-host distributions include the target-platform native executable, its matching standard libraries, and Microsoft license notices. No workspace executable or PATH lookup is used. Servers stop after five idle minutes; the pool admits at most four servers, evicting idle entries first. A failed native process falls back to the worker.

The reproducible production-transport benchmark is:

```powershell
$env:ORCA_BACKGROUND_LAUNCH='1'
node config/scripts/performance/editor-navigation/benchmark-typescript-navigation.mjs
```

On this Windows x64 checkout it measured 3.95 seconds for a cold reference query, 145 ms for a repeated query, 2.84 seconds for background preparation, and 204 ms for the first reference query after preparation. It stages the packaged binary and standard libraries and uses Dorca's actual worker-thread process transport. It verifies the three call references with declarations excluded. These are diagnostic measurements, not timing assertions or full Electron interaction measurements.

The staged native-server integration tests verify renamed imports and reexports, unrelated same-name symbols, definition targets, unsaved buffers, UTF-16 positions after an emoji, and disk restoration after a draft closes. Native execution has been verified on Windows x64; macOS/Linux packaging paths have not been executed here. The installed application remains unchanged until these source changes are built and installed.

Final validation passed: 50 tests across eight focused navigation, artifact, and packaging suites (one existing skip), Node/web/CLI typechecks, changed-code quality, formatting, the generated standard-library manifest check, and the flaky-test ratchet. The full Electron Vite production build also passed, including preload and renderer boot-graph verification. No visible application window was launched or installed application replaced.
