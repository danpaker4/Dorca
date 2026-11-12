Dorca 2.0.6 fixes initialization of Go to Definition and Find References in JavaScript and TypeScript workspaces.

- Workspace navigation providers register directly, so they work regardless of when Monaco initializes its built-in providers.
- Built-in definition and reference handlers are disabled to keep navigation on the workspace-aware semantic resolver.
- Existing project configuration, import resolution, unsaved buffers, and local/remote ownership checks are preserved.

Validated with a regression that fails before the fix, focused editor tests, and a real Monaco browser-worker check with an existing provider already registered.

Includes stable [Orca v1.4.257](https://github.com/stablyai/orca/releases/tag/v1.4.257), upstream commit `b0570d90fc9af8c9e7e3566c0fb841d0884e2462`.

Windows x64: download and run **dorca-windows-setup.exe**, or use **Download → Update & Restart** in Dorca. This release contains no macOS or Linux installer.
