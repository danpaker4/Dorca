Dorca 2.0.13 adds native Git blame and improves Git review inside the editor.

- Show blame for the current line or the whole file, with author, age and commit summary.
- Review commit details and changed lines in the hover, copy hashes/messages, browse line history, open revisions and comparisons, or send the displayed change to an agent with Explain.
- Scroll through the full file inside an inline Git peek, with previous/next change navigation and a change counter.
- Use small deletion triangles at line gaps, including multiline and beginning/end-of-file deletions.
- Use Go to Definition from working-tree TypeScript/JavaScript diffs and peeks, with normal editor tabs and Back navigation. Historical definitions show an explicit unavailable notice.
- Keep edited and untracked lines marked uncommitted, including safe history navigation for newly inserted lines and updates after commits.

Blame supports text files up to 1 MiB and 20,000 lines. Settings offer Off, Current line and Whole file; editor commands include Toggle File Blame and Show Line History.

This release contains the Windows x64 installer and automatic-update metadata only. No macOS or Linux installers are included.

Includes stable [Orca v1.4.261](https://github.com/stablyai/orca/releases/tag/v1.4.261), upstream commit `92d4266cc4ffa945dbc1fa52850e62448d2dfc1c`, while preserving Dorca's branding and update feed.
