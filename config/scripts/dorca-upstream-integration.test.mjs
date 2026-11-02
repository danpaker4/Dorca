import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { integrateOrcaRelease } from './dorca-upstream-integration.mjs'

const directories = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

async function repository() {
  const cwd = await mkdtemp(join(tmpdir(), 'dorca-upstream-'))
  directories.push(cwd)
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'Dorca test')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'core.autocrlf', 'false')
  git('config', 'core.hooksPath', join(cwd, 'empty-hooks'))
  const write = async (file, content) => {
    await mkdir(join(cwd, file, '..'), { recursive: true })
    await writeFile(join(cwd, file), content)
  }
  const commit = (message) => {
    git('add', '--all')
    git('commit', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  return { cwd, git, write, commit }
}

describe('official Orca release integration', () => {
  it('combines source changes while retaining Dorca workflows without importing upstream workflow history', async () => {
    const repo = await repository()
    const source = `upstream = 1\n${'unchanged\n'.repeat(12)}dorca = false\n`
    await repo.write('feature.txt', source)
    await repo.write('.github/workflows/build.yml', 'Dorca workflow')
    await repo.write('.github/actions/build/action.yml', 'old build action')
    const previousSha = repo.commit('base release')
    repo.git('switch', '-c', 'upstream')
    await repo.write('feature.txt', source.replace('upstream = 1', 'upstream = 2'))
    await repo.write('.github/workflows/build.yml', 'Orca signing workflow')
    await repo.write('.github/actions/build/action.yml', 'new build action')
    const nextSha = repo.commit('next Orca release')
    repo.git('switch', 'main')
    await repo.write('feature.txt', source.replace('dorca = false', 'dorca = true'))
    repo.commit('Dorca customization')
    integrateOrcaRelease(previousSha, nextSha, repo.cwd)
    expect(await readFile(join(repo.cwd, 'feature.txt'), 'utf8')).toBe(
      source.replace('upstream = 1', 'upstream = 2').replace('dorca = false', 'dorca = true')
    )
    expect(await readFile(join(repo.cwd, '.github/workflows/build.yml'), 'utf8')).toBe(
      'Dorca workflow'
    )
    expect(await readFile(join(repo.cwd, '.github/actions/build/action.yml'), 'utf8')).toBe(
      'new build action'
    )
    repo.commit('integrated release')
    expect(repo.git('rev-list', '--count', `${previousSha}..HEAD`)).toBe('2')
    expect(repo.git('diff', '--name-only', `${previousSha}..HEAD`, '--', '.github/workflows')).toBe(
      ''
    )
  })

  it('stops on incompatible source changes instead of favoring one project silently', async () => {
    const repo = await repository()
    await repo.write('feature.txt', 'original\n')
    const previousSha = repo.commit('base release')
    repo.git('switch', '-c', 'upstream')
    await repo.write('feature.txt', 'new Orca behavior\n')
    const nextSha = repo.commit('next Orca release')
    repo.git('switch', 'main')
    await repo.write('feature.txt', 'custom Dorca behavior\n')
    repo.commit('Dorca customization')
    expect(() => integrateOrcaRelease(previousSha, nextSha, repo.cwd)).toThrow(
      'manual conflict resolution: feature.txt'
    )
    expect(repo.git('diff', '--name-only', '--diff-filter=U')).toBe('feature.txt')
  })
})
