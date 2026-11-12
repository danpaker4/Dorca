Dorca 2.0.4 includes inline Git change review, semantic JavaScript/TypeScript navigation, the corrected Windows CLI launcher, and the stable Orca v1.4.257 release.

- Click a Git gutter marker to review its hunk without leaving Source. Solid markers represent unstaged changes; dotted markers represent staged changes. The editor's **Peek Git Change** context-menu action and Alt+F7 provide keyboard access.
- Stage or unstage one hunk, move between changes, close the panel, or revert an unstaged hunk through the editor's undo stack.
- Markers follow the live editor buffer. Save before staging or unstaging; these actions never implicitly save or stage unsaved content. Revert remains available for unsaved edits and can be undone.
- Hunk actions revalidate the disk, HEAD, index and buffer snapshot. Index updates hold Git's native index lock, preserve other index entries, and leave working files untouched.
- Local, WSL and runtime-owned SSH/paired files use the owning host's Git. Git-backed folder workspaces use their repository's index; non-Git folders have no Git markers. Conflicted, binary, non-UTF-8, filtered and oversized files retain their existing full-file workflows.

- Go to Definition and Find References now use TypeScript's project-aware language service. Unrelated classes with the same name, comments, and string matches are excluded. Configured imports, aliases, reexports, JSX/TSX, and unsaved buffers are supported within the owning workspace and project graph.
- The Windows CLI launcher uses the packaged Dorca executable identity instead of looking for `Orca.exe`. Native build caching no longer treats an unverified installed launcher as a freshly compiled binary.

Upstream: [Orca v1.4.257](https://github.com/stablyai/orca/releases/tag/v1.4.257), commit `b0570d90fc9af8c9e7e3566c0fb841d0884e2462`, published November 12, 2026. The actual release deltas from v1.4.251 through v1.4.255 and v1.4.257 were applied using Dorca's fork integration workflow. Dorca retains its branding, release workflows, update feed, native build customizations and TypeScript workspace intelligence. This is a patch-equivalent integration rather than upstream Git ancestry.

This build produces a Windows x64 installer and update metadata. No macOS or Linux installer is built.
