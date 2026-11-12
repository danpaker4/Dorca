Dorca 2.0.5 fixes Go to Definition in JavaScript and TypeScript projects.

- Resolved definitions are returned without waiting for unrelated dependencies that could exhaust the resolver's file budget and produce "No definition found."
- Project configuration is loaded before resolving symbols, preserving configured imports, aliases and project references.
- Ignored build output no longer fills the source inventory and prevents navigation in large workspaces.

Validated with the reported `CLIPBOARD_TEXT_WRITE_MAX_BYTES` reference and the monorepo's `Server` class using the real Monaco browser worker, plus regression tests for the dependency and inventory failures.

Includes the Dorca 2.0.4 features and stable [Orca v1.4.257](https://github.com/stablyai/orca/releases/tag/v1.4.257), upstream commit `b0570d90fc9af8c9e7e3566c0fb841d0884e2462`.

Windows x64: download and run **dorca-windows-setup.exe**, or use **Download → Update & Restart** in Dorca. This release contains no macOS or Linux installer.
