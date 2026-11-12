Dorca 2.0.4 includes inline Git change review in the normal Source editor and the stable Orca v1.4.255 release.

- Click a Git gutter marker to review its hunk without leaving Source. Solid markers represent unstaged changes; dotted markers represent staged changes. The editor's **Peek Git Change** context-menu action and Alt+F7 provide keyboard access.
- Stage or unstage one hunk, move between changes, close the panel, or revert an unstaged hunk through the editor's undo stack.
- Markers follow the live editor buffer. Save before staging or unstaging; these actions never implicitly save or stage unsaved content. Revert remains available for unsaved edits and can be undone.
- Hunk actions revalidate the disk, HEAD, index and buffer snapshot. Index updates hold Git's native index lock, preserve other index entries, and leave working files untouched.
- Local, WSL and runtime-owned SSH/paired files use the owning host's Git. Git-backed folder workspaces use their repository's index; non-Git folders have no Git markers. Conflicted, binary, non-UTF-8, filtered and oversized files retain their existing full-file workflows.

Upstream: [Orca v1.4.255](https://github.com/stablyai/orca/releases/tag/v1.4.255), commit `084ce0eebbdda3f665251984804f2238be666296`, published November 9, 2026. The actual release delta from v1.4.251 was applied using Dorca's fork integration workflow. Dorca retains its branding, release workflows, update feed, native build customizations and TypeScript workspace intelligence. This is a patch-equivalent integration rather than upstream Git ancestry.

Windows and macOS installers are produced and verified by the existing Dorca release workflows.
