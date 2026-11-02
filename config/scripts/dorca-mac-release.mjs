import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createDorcaMacManifest } from './dorca-mac-assets.mjs'

const REPO = 'danpaker4/Dorca'
const run = (args) => execFileSync('gh', args, { encoding: 'utf8' }).trim()
if (process.env.GITHUB_REPOSITORY !== REPO) {
  throw new Error(`Run this workflow in ${REPO}`)
}
const requestedTag = process.env.DORCA_MAC_TAG?.trim()
if (requestedTag && !/^v\d+\.\d+\.\d+$/.test(requestedTag)) {
  throw new Error('Select a stable Dorca release tag')
}
const release = requestedTag
  ? JSON.parse(run(['api', `repos/${REPO}/releases?per_page=100`])).find(
      (entry) => entry.tag_name === requestedTag
    )
  : JSON.parse(run(['api', `repos/${REPO}/releases/latest`]))
if (!release) {
  throw new Error('The requested Dorca release was not found in the recent release list')
}
if (
  (release.draft && !requestedTag) ||
  release.prerelease ||
  !/^v\d+\.\d+\.\d+$/.test(release.tag_name)
) {
  throw new Error(
    'Mac installers require a stable Dorca release; draft builds need an explicit tag'
  )
}
const tag = release.tag_name
const version = tag.slice(1)

if (process.argv[2] === 'plan') {
  const required = ['dorca-macos-x64.dmg', 'dorca-macos-arm64.dmg', 'latest-mac.yml']
  const needed = !required.every((name) => release.assets.some((asset) => asset.name === name))
  if (needed) {
    run([
      'api',
      `repos/${REPO}/contents/config/electron-builder.dorca-mac.config.cjs?ref=${tag}`,
      '--jq',
      '.sha'
    ])
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `needed=${needed}\ntag=${tag}\nversion=${version}\n`)
  console.log(
    needed ? `Building Mac installers for ${tag}` : `${tag} already includes Mac installers`
  )
} else if (process.argv[2] === 'publish') {
  const descriptions = ['x64', 'arm64'].map((arch) =>
    JSON.parse(readFileSync(`.build/dorca-mac/${arch}.json`, 'utf8'))
  )
  const manifest = createDorcaMacManifest(version, descriptions, release.assets)
  mkdirSync('.build/dorca-mac', { recursive: true })
  const filename = '.build/dorca-mac/latest-mac.yml'
  writeFileSync(filename, manifest)
  // Publish notification metadata only after both architectures match their verified installer bytes.
  run(['release', 'upload', tag, filename, '--repo', REPO, '--clobber'])
  const marker = '### macOS installers'
  if (!(release.body || '').includes(marker)) {
    const notes = '.build/dorca-mac/release-notes.md'
    writeFileSync(
      notes,
      `${release.body || ''}\n\n${marker}\n\n- Apple Silicon (M-series): **dorca-macos-arm64.dmg**\n- Intel: **dorca-macos-x64.dmg**\n\nOpen the DMG, quit Dorca and copy Dorca into Applications, replacing the previous version. These builds have no Apple Developer ID signature or notarization. If macOS blocks opening Dorca, review the download and use Privacy & Security → Open Anyway where permitted.\n\nMac update notifications open this release page; installing each update is manual.\n`
    )
    run(['release', 'edit', tag, '--repo', REPO, '--notes-file', notes])
  }
  console.log(`Mac installers and notification metadata published for ${tag}`)
} else {
  throw new Error('Usage: node config/scripts/dorca-mac-release.mjs plan|publish')
}
