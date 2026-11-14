Dorca 2.0.12 fixes slow definition lookups after navigating back with Alt+Left.

- Editor preparation preserves the workspace's open buffers and retained drafts, avoiding unnecessary language-server document closes and reloads when switching files.
- Definition and reference requests use the same buffer selection as preparation, including existing host and project ownership boundaries.

This release includes the Windows x64 installer and automatic-update metadata. No macOS or Linux installers are included.

Includes stable [Orca v1.4.258](https://github.com/stablyai/orca/releases/tag/v1.4.258), upstream commit `c91a7a6ee3dc76090cafb33943961ae2235246d6`.
