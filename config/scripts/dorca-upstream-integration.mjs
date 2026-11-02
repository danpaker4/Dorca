import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolvePackageVersionConflict } from './dorca-release-plan.mjs'

export function integrateOrcaRelease(previousSha, nextSha, cwd = process.cwd()) {
  if (![previousSha, nextSha].every((sha) => /^[0-9a-f]{40}$/.test(sha))) {
    throw new Error('Upstream integration requires exact release commit IDs')
  }
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
  // Keep Dorca's workflow definitions: GITHUB_TOKEN cannot update workflows, and Orca's require its signing infrastructure.
  const patch = execFileSync(
    'git',
    [
      'diff',
      '--binary',
      '--full-index',
      previousSha,
      nextSha,
      '--',
      '.',
      ':(exclude).github/workflows'
    ],
    { cwd, maxBuffer: 64 * 1024 * 1024 }
  )
  if (!patch.length) {
    return
  }
  const applied = spawnSync('git', ['apply', '--3way', '--index', '--whitespace=nowarn'], {
    cwd,
    input: patch,
    stdio: ['pipe', 'inherit', 'inherit']
  })
  if (applied.error) {
    throw applied.error
  }
  if (applied.status === 0) {
    return
  }
  const conflicts = git('diff', '--name-only', '--diff-filter=U').split(/\r?\n/).filter(Boolean)
  if (conflicts.length !== 1 || conflicts[0] !== 'package.json') {
    throw new Error(
      `Orca integration needs manual conflict resolution: ${conflicts.join(', ') || 'release patch could not apply'}. Nothing has been published.`
    )
  }
  const packagePath = join(cwd, 'package.json')
  writeFileSync(packagePath, resolvePackageVersionConflict(readFileSync(packagePath, 'utf8')))
  git('add', 'package.json')
}
