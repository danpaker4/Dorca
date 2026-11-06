import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolvePackageVersionConflict } from './dorca-release-plan.mjs'

export function integrateOrcaRelease(previousSha, nextSha, cwd = process.cwd()) {
  if (![previousSha, nextSha].every((sha) => /^[0-9a-f]{40}$/.test(sha))) {
    throw new Error('Upstream integration requires exact release commit IDs')
  }
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
  const directory = mkdtempSync(join(tmpdir(), 'dorca-release-patch-'))
  try {
    const patchPath = join(directory, 'upstream.patch')
    // Keep Dorca's workflow definitions: GITHUB_TOKEN cannot update workflows, and Orca's require its signing infrastructure.
    execFileSync(
      'git',
      [
        'diff',
        '--binary',
        '--full-index',
        `--output=${patchPath}`,
        previousSha,
        nextSha,
        '--',
        '.',
        ':(exclude).github/workflows'
      ],
      { cwd, stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true }
    )
    if (statSync(patchPath).size === 0) {
      return
    }
    const applied = spawnSync(
      'git',
      ['apply', '--3way', '--index', '--whitespace=nowarn', patchPath],
      { cwd, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true }
    )
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
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
