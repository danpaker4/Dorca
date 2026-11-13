Dorca 2.0.10 fixes Windows terminal flashes during editor navigation and adds independent editor cursor and selection colors.

- Runtime file watchers use the Windows backend directly, skipping the Watchman probe that briefly opened a terminal after an idle navigation restart.
- JavaScript and TypeScript navigation servers remain warm for 15 idle minutes instead of five.
- Theme plugins can set the cursor, active selection and inactive selection separately, including opaque selection backgrounds.
- Dark Modern Editor plugin 0.3.1 uses VS Code's gray cursor (`#aeafad`) and solid blue selection (`#264f78`). Dark Modern OLED retains its previous colors.

This release includes the Windows x64 installer and automatic-update metadata. No macOS or Linux installers are included.

Includes stable [Orca v1.4.258](https://github.com/stablyai/orca/releases/tag/v1.4.258), upstream commit `c91a7a6ee3dc76090cafb33943961ae2235246d6`.
