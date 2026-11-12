import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { planDorcaRelease } from './dorca-release-plan.mjs'
import { integrateOrcaRelease } from './dorca-upstream-integration.mjs'

const REPO = 'danpaker4/Dorca'
const METADATA = 'config/dorca-release.json'
const metadata = () => JSON.parse(readFileSync(METADATA, 'utf8'))
const run = (command, args) =>
  execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
const git = (...args) => run('git', args)
const gh = (...args) => run('gh', [...args, '--repo', REPO])

function readDorcaRelease(tag) {
  const result = spawnSync(
    'gh',
    ['release', 'view', tag, '--repo', REPO, '--json', 'isDraft,targetCommitish'],
    { encoding: 'utf8' }
  )
  if (result.error) {
    throw result.error
  }
  if (result.status === 0) {
    return JSON.parse(result.stdout)
  }
  if (/release not found|404/i.test(result.stderr)) {
    return null
  }
  throw new Error(`Cannot check whether release ${tag} exists: ${result.stderr}`)
}

if (process.env.GITHUB_REPOSITORY !== REPO) {
  throw new Error(`Run this workflow in ${REPO}`)
}

if (process.argv[2] === 'prepare') {
  if (git('status', '--porcelain')) {
    throw new Error('Release preparation requires a clean checkout')
  }
  const requestedTag = process.env.DORCA_UPSTREAM_TAG?.trim()
  if (requestedTag && !/^v\d+\.\d+\.\d+$/.test(requestedTag)) {
    throw new Error('Select an official stable Orca release tag')
  }
  const upstreamTag = run('gh', [
    'api',
    requestedTag
      ? `repos/stablyai/orca/releases/tags/${requestedTag}`
      : 'repos/stablyai/orca/releases/latest',
    '--jq',
    'if .draft or .prerelease then error("Not a published stable release") else .tag_name end'
  ])
  const current = metadata()
  let next = planDorcaRelease(
    current,
    upstreamTag,
    process.env.DORCA_RELEASE_VERSION,
    process.env.GITHUB_EVENT_NAME === 'schedule'
  )
  if (!next) {
    const currentRelease = readDorcaRelease(`v${current.version}`)
    if (!currentRelease || currentRelease.isDraft) {
      next = current
    }
  }
  if (!next) {
    appendFileSync(process.env.GITHUB_OUTPUT, 'should_release=false\n')
    console.log('No newer Orca release; no Dorca release needed.')
    process.exit(0)
  }
  const existingRelease = readDorcaRelease(`v${next.version}`)
  if (existingRelease && !existingRelease.isDraft) {
    throw new Error(`Dorca v${next.version} is already published; choose a newer version`)
  }
  git('config', 'user.name', 'github-actions[bot]')
  git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')
  if (next.upstreamTag !== current.upstreamTag) {
    git('fetch', '--no-tags', 'https://github.com/stablyai/orca.git', 'tag', current.upstreamTag)
    const previousSha = git('rev-parse', 'FETCH_HEAD^{commit}')
    git('fetch', '--no-tags', 'https://github.com/stablyai/orca.git', 'tag', next.upstreamTag)
    integrateOrcaRelease(previousSha, git('rev-parse', 'FETCH_HEAD^{commit}'))
  }
  git('fetch', '--no-tags', 'https://github.com/stablyai/orca.git', 'tag', next.upstreamTag)
  const upstreamCommit = git('rev-parse', 'FETCH_HEAD^{commit}')
  if (
    next.upstreamTag === current.upstreamTag &&
    current.upstreamCommit &&
    current.upstreamCommit !== upstreamCommit
  ) {
    throw new Error('The upstream release tag no longer matches the integrated commit')
  }
  next = { ...next, upstreamCommit }
  writeFileSync(METADATA, `${JSON.stringify(next, null, 2)}\n`)
  git('add', METADATA)
  if (git('diff', '--cached', '--name-only')) {
    git('commit', '-m', `release: prepare Dorca v${next.version} with Orca ${next.upstreamTag}`)
  }
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `should_release=true\nversion=${next.version}\ntag=v${next.version}\n`
  )
} else if (process.argv[2] === 'verify') {
  const { verifyDorcaReleaseAssets } = await import('./dorca-release-assets.mjs')
  await verifyDorcaReleaseAssets('dist', metadata().version)
  const { parse } = await import('yaml')
  const feed = parse(readFileSync('dist/win-unpacked/resources/app-update.yml', 'utf8'))
  if (
    feed.provider !== 'github' ||
    feed.owner !== 'danpaker4' ||
    feed.repo !== 'Dorca' ||
    feed.publisherName
  ) {
    throw new Error('The packaged updater does not target the unsigned Dorca release feed')
  }
  const { extractFile } = await import('@electron/asar')
  const packaged = JSON.parse(
    extractFile('dist/win-unpacked/resources/app.asar', 'package.json').toString()
  )
  if (packaged.version !== metadata().version || packaged.productName !== 'Dorca') {
    throw new Error('Packaged app identity/version does not match this Dorca release')
  }
  console.log(`Verified Dorca ${packaged.version}: installer, checksums, version and update feed.`)
} else if (process.argv[2] === 'publish') {
  const { DORCA_RELEASE_ASSETS, verifyDorcaReleaseAssets } =
    await import('./dorca-release-assets.mjs')
  const release = metadata()
  const latestTag = run('gh', ['api', 'repos/stablyai/orca/releases/latest', '--jq', '.tag_name'])
  if (latestTag !== release.upstreamTag) {
    throw new Error(
      `Orca ${latestTag} is now stable. Prepare and validate it before publishing Dorca.`
    )
  }
  if (!/^[a-f0-9]{40}$/.test(release.upstreamCommit ?? '')) {
    throw new Error('Release metadata must record the exact integrated Orca commit')
  }
  const tag = `v${release.version}`
  await verifyDorcaReleaseAssets('dist', release.version)
  const head = git('rev-parse', 'HEAD')
  const existing = readDorcaRelease(tag)
  if (existing) {
    if (!existing.isDraft || existing.targetCommitish !== head) {
      throw new Error('Refusing to replace an existing or unrelated release')
    }
  }
  // A non-fast-forward push stops publication if main changed while the build was running.
  git('push', 'origin', 'HEAD:refs/heads/main')
  const notes = join(process.env.RUNNER_TEMP, 'dorca-release-notes.md')
  const featureNotesPath = `docs/releases/dorca-${release.version}.md`
  const featureNotes = existsSync(featureNotesPath)
    ? `${readFileSync(featureNotesPath, 'utf8')}\n\n`
    : ''
  writeFileSync(
    notes,
    `${featureNotes}Dorca ${release.version}, based on Orca ${release.upstreamTag}, upstream commit \`${release.upstreamCommit}\`.\n\nWindows: download and run **dorca-windows-setup.exe**. Future Windows releases install through **Download → Update & Restart**, without Git or compilation.\n\nWindows installers are unsigned and may show an unknown-publisher prompt. Mac installers are added by the macOS build workflow after validation; Mac updates are installed manually.\n`
  )
  if (!existing) {
    gh(
      'release',
      'create',
      tag,
      '--target',
      head,
      '--draft',
      '--title',
      `Dorca ${release.version}`,
      '--notes-file',
      notes
    )
  }
  gh(
    'release',
    'upload',
    tag,
    ...DORCA_RELEASE_ASSETS.map((name) => join('dist', name)),
    '--clobber'
  )
  gh('release', 'edit', tag, '--draft=false', '--latest')
  console.log(`Published https://github.com/${REPO}/releases/tag/${tag}`)
} else {
  throw new Error('Usage: node config/scripts/dorca-release.mjs prepare|verify|publish')
}
