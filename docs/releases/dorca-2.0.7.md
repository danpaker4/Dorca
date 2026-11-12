Dorca 2.0.7 improves JavaScript and TypeScript code navigation and makes inline Git change previews more compact.

- Go to Definition and Find All References reuse their workspace worker and resolved project state between requests.
- Import discovery avoids repeatedly rebuilding the TypeScript program while source files load.
- Deep lookups no longer silently stop after 32 loading rounds.
- Cached file snapshots refresh when workspace files change, with local and remote ownership checks preserved.
- Inline Git change previews fit their rendered content instead of reserving unnecessary empty space.

The reproduced deep-import lookup improved from about four seconds followed by no result to about 170 milliseconds. This measurement is from the regression fixture; project and host performance varies.

Includes stable [Orca v1.4.257](https://github.com/stablyai/orca/releases/tag/v1.4.257), upstream commit `b0570d90fc9af8c9e7e3566c0fb841d0884e2462`.

Windows x64: download and run **dorca-windows-setup.exe**, or use **Download → Update & Restart** in Dorca. This release contains no macOS or Linux installer.
