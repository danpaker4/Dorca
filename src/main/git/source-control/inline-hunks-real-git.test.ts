import { chmod, mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installRealWorkerThreadChildProcesses } from '../../worker-thread-child-process/worker-thread-child-process-real.test-fixtures'
import { applyGitInlineHunk, getGitInlineSnapshot } from './inline-hunks'

const roots: string[] = []
async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await runProcess({ program: 'git', args, cwd })
  if (result.code !== 0) {
    throw new Error(String(result.stderr))
  }
  return String(result.stdout)
}
async function repository(
  content = 'one\ntwo\nthree\nfour\nfive\n',
  commit = true
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dorca-inline-hunks-'))
  roots.push(root)
  await git(root, 'init', '--quiet')
  await git(root, 'config', 'user.name', 'Inline test')
  await git(root, 'config', 'user.email', 'inline@example.test')
  await git(root, 'config', 'core.autocrlf', 'false')
  await writeFile(join(root, 'file.txt'), content)
  if (commit) {
    await git(root, 'add', '.')
    await git(root, 'commit', '--quiet', '-m', 'baseline')
  }
  return root
}
async function apply(
  root: string,
  staged: boolean,
  hunkIndex: number,
  filePath = 'file.txt'
): Promise<void> {
  const snapshot = await getGitInlineSnapshot(root, filePath)
  await applyGitInlineHunk(root, {
    token: snapshot.token,
    filePath,
    staged,
    hunkIndex,
    bufferContent: snapshot.diskContent
  })
}
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('inline Git hunk transactions with real Git', () => {
  it('stages and unstages one hunk while retaining other index and disk edits', async () => {
    const root = await repository()
    await writeFile(join(root, 'file.txt'), 'ONE\ntwo\nthree\nfour\nfive\n')
    await git(root, 'add', 'file.txt')
    await writeFile(join(root, 'file.txt'), 'ONE\ntwo\nTHREE\nfour\nFIVE\n')
    await writeFile(join(root, 'other.txt'), 'other staged content\n')
    await git(root, 'add', 'other.txt')
    await apply(root, false, 0)
    expect(await git(root, 'show', ':file.txt')).toBe('ONE\ntwo\nTHREE\nfour\nfive\n')
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('ONE\ntwo\nTHREE\nfour\nFIVE\n')
    await apply(root, true, 0)
    expect(await git(root, 'show', ':file.txt')).toBe('one\ntwo\nTHREE\nfour\nfive\n')
    expect(await git(root, 'show', ':other.txt')).toBe('other staged content\n')
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('ONE\ntwo\nTHREE\nfour\nFIVE\n')
  })

  it.each(['disk', 'index', 'head', 'unsaved'] as const)(
    'rejects a stale %s action without changing the index',
    async (change) => {
      const root = await repository()
      await writeFile(join(root, 'file.txt'), 'ONE\ntwo\nthree\nfour\nfive\n')
      const snapshot = await getGitInlineSnapshot(root, 'file.txt')
      if (change === 'disk') {
        await writeFile(join(root, 'file.txt'), 'agent update\n')
      }
      if (change === 'index') {
        await git(root, 'add', 'file.txt')
      }
      if (change === 'head') {
        await git(root, 'commit', '--allow-empty', '--quiet', '-m', 'agent commit')
      }
      const indexBefore = await readFile(join(root, '.git', 'index'))
      await expect(
        applyGitInlineHunk(root, {
          token: snapshot.token,
          filePath: 'file.txt',
          staged: false,
          hunkIndex: 0,
          bufferContent: change === 'unsaved' ? 'unsaved\n' : snapshot.diskContent
        })
      ).rejects.toThrow(change === 'unsaved' ? /Save this file/ : /stale/)
      expect(await readFile(join(root, '.git', 'index'))).toEqual(indexBefore)
    }
  )

  it('leaves an external Git lock in place', async () => {
    const root = await repository()
    await writeFile(join(root, 'file.txt'), 'changed\n')
    await writeFile(join(root, '.git', 'index.lock'), 'external owner')
    await expect(apply(root, false, 0)).rejects.toThrow()
    expect(await readFile(join(root, '.git', 'index.lock'), 'utf8')).toBe('external owner')
  })

  it('stages deletions and unstages them without recreating the working file', async () => {
    const root = await repository('before\n')
    await unlink(join(root, 'file.txt'))
    await apply(root, false, 0)
    expect(await git(root, 'ls-files', '--', 'file.txt')).toBe('')
    await apply(root, true, 0)
    expect(await git(root, 'show', ':file.txt')).toBe('before\n')
    await expect(readFile(join(root, 'file.txt'))).rejects.toThrow()
  })

  it('stages new files in an unborn repository and unstages the addition', async () => {
    const root = await repository()
    await writeFile(join(root, 'new.txt'), 'new text')
    await apply(root, false, 0, 'new.txt')
    expect(await git(root, 'show', ':new.txt')).toBe('new text')
    await apply(root, true, 0, 'new.txt')
    expect(await git(root, 'ls-files', '--', 'new.txt')).toBe('')
    const unborn = await repository('', false)
    await writeFile(join(unborn, 'new.txt'), 'new text')
    await apply(unborn, false, 0, 'new.txt')
    expect(await git(unborn, 'show', ':new.txt')).toBe('new text')
  })

  it('keeps a tracked empty file when unstaging a modification', async () => {
    const root = await repository('')
    await writeFile(join(root, 'file.txt'), 'text\n')
    await git(root, 'add', 'file.txt')
    await apply(root, true, 0)
    expect(await git(root, 'ls-files', '--', 'file.txt')).toBe('file.txt\n')
    expect(await git(root, 'show', ':file.txt')).toBe('')
  })

  it('stages and unstages empty-file additions and deletions', async () => {
    const root = await repository('')
    await writeFile(join(root, 'empty.txt'), '')
    await apply(root, false, 0, 'empty.txt')
    expect(await git(root, 'ls-files', '--', 'empty.txt')).toBe('empty.txt\n')
    await apply(root, true, 0, 'empty.txt')
    expect(await git(root, 'ls-files', '--', 'empty.txt')).toBe('')
    await unlink(join(root, 'file.txt'))
    await apply(root, false, 0)
    expect(await git(root, 'ls-files', '--', 'file.txt')).toBe('')
    await apply(root, true, 0)
    expect(await git(root, 'ls-files', '--', 'file.txt')).toBe('file.txt\n')
  })

  it('does not offer ignored files for hunk staging', async () => {
    const root = await repository()
    await writeFile(join(root, '.gitignore'), 'secret.txt\n')
    await writeFile(join(root, 'secret.txt'), 'secret\n')
    await expect(getGitInlineSnapshot(root, 'secret.txt')).rejects.toThrow(/ignored/)
    expect(await git(root, 'ls-files', '--', 'secret.txt')).toBe('')
  })

  it('honors global Git attributes before allowing hunk writes', async () => {
    const root = await repository()
    const attributes = join(root, 'global-attributes')
    const config = join(root, 'global-config')
    await writeFile(attributes, '*.txt filter=external\n')
    await git(root, 'config', '--file', config, 'core.attributesFile', attributes)
    vi.stubEnv('GIT_CONFIG_GLOBAL', config)
    await expect(getGitInlineSnapshot(root, 'file.txt')).rejects.toThrow(/conversion filters/)
  })

  it('uses the correct index for linked worktrees and Git-backed folders', async () => {
    const root = await repository()
    const linked = join(root, 'linked')
    await git(root, 'worktree', 'add', '--quiet', '-b', 'linked', linked)
    await mkdir(join(linked, 'folder'))
    await writeFile(join(linked, 'folder', 'new file.txt'), 'folder addition\n')
    await apply(join(linked, 'folder'), false, 0, 'new file.txt')
    expect(await git(linked, 'show', ':folder/new file.txt')).toBe('folder addition\n')
    expect(await git(root, 'ls-files', '--', 'folder/new file.txt')).toBe('')
    await apply(join(linked, 'folder'), true, 0, 'new file.txt')
    expect(await git(linked, 'ls-files', '--', 'folder/new file.txt')).toBe('')
  })

  it('preserves executable permissions when staging a new file', async () => {
    const root = await repository()
    await writeFile(join(root, 'script.sh'), 'echo ready\n')
    await chmod(join(root, 'script.sh'), 0o755)
    await apply(root, false, 0, 'script.sh')
    const entry = await git(root, 'ls-files', '--stage', '--', 'script.sh')
    if (process.platform === 'win32') {
      expect(entry.startsWith('100644 ')).toBe(true)
    } else {
      expect(entry.startsWith('100755 ')).toBe(true)
    }
  })

  it('preserves missing final newlines and unrelated CRLF content', async () => {
    const root = await repository('one\r\ntwo\r\nthree')
    await writeFile(join(root, 'file.txt'), 'ONE\r\ntwo\r\nTHREE')
    await apply(root, false, 0)
    expect(await git(root, 'show', ':file.txt')).toBe('ONE\r\ntwo\r\nthree')
  })
})

installRealWorkerThreadChildProcesses()
