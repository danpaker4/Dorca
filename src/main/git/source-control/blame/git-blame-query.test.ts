import { mkdtemp, rm, writeFile, rename, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { runProcess } from '@orca/process-host'
import { installRealWorkerThreadChildProcesses } from '../../../worker-thread-child-process/worker-thread-child-process-real.test-fixtures'
import { queryGitBlame } from './git-blame-query'

installRealWorkerThreadChildProcesses()

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dorca-blame-'))
  roots.push(root)
  const git = async (...args: string[]): Promise<string> => {
    const result = await runProcess({
      program: 'git',
      args: ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args],
      cwd: root
    })
    if (result.code !== 0) {
      throw new Error(result.stderr)
    }
    return result.stdout.trim()
  }
  await git('init', '--quiet')
  await git('config', 'user.name', 'Alice')
  await git('config', 'user.email', 'alice@example.test')
  const query = (
    bufferContent: string,
    options: {
      filePath?: string
      mode?: 'snapshot' | 'detail'
      line?: number
      revision?: string
    } = {}
  ) =>
    queryGitBlame(
      root,
      {
        channel: randomUUID(),
        sequence: 1,
        mode: 'snapshot',
        filePath: 'file.ts',
        bufferContent,
        ...options
      },
      { signal: AbortSignal.timeout(15000), admissionTier: 'background' }
    )
  return { root, git, query }
}

it('attributes only unchanged spans after replacements, insertions and deletions in an unsaved buffer', async () => {
  const { root, git, query } = await fixture()
  await writeFile(join(root, 'file.ts'), 'first\nsecond\nthird\nfourth\n')
  await git('add', '.')
  await git('commit', '--quiet', '-m', 'Initial lines')
  const { snapshot } = await query('inserted\nfirst\nchanged\nfourth\n')
  expect(snapshot?.lines.map((line) => [line.line, line.author, line.summary])).toEqual([
    [1, 'You', 'Uncommitted changes'],
    [2, 'Alice', 'Initial lines'],
    [3, 'You', 'Uncommitted changes'],
    [4, 'Alice', 'Initial lines'],
    [5, 'You', 'Uncommitted changes']
  ])
  expect(snapshot?.lines[2].commit).toBeNull()
})

it('returns root commit details and the deleted/added preview without inventing a parent', async () => {
  const { root, git, query } = await fixture()
  await writeFile(join(root, 'file.ts'), 'first\nsecond\n')
  await git('add', '.')
  await git('commit', '--quiet', '-m', 'Root message\n\nFull commit body')
  const { detail } = await query('first\nsecond\n', { mode: 'detail', line: 1 })
  expect(detail?.parent).toBeNull()
  expect(detail?.message).toBe('Root message\n\nFull commit body')
  expect(detail?.original).toBe('')
  expect(detail?.modified).toBe('first\n')
})

it('reports the working tree diff against HEAD, including staged and unsaved edits', async () => {
  const { root, git, query } = await fixture()
  await writeFile(join(root, 'file.ts'), 'first\nsecond\nthird\n')
  await git('add', '.')
  await git('commit', '--quiet', '-m', 'Baseline')
  await writeFile(join(root, 'file.ts'), 'first\nstaged\nthird\n')
  await git('add', '.')
  const { detail } = await query('first\nunsaved\nthird\n', { mode: 'detail', line: 2 })
  expect(detail?.attribution.commit).toBeNull()
  expect(detail?.original).toBe('second\n')
  expect(detail?.modified).toBe('unsaved\n')
})

it.each([
  {
    name: 'a line in a multi-line replacement',
    before: 'first\nold second\nold third\nlast\n',
    after: 'first\nnew second\nnew third\nlast\n',
    line: 3,
    original: 'old third\n',
    modified: 'new third\n'
  },
  {
    name: 'a replacement that removes continuation lines',
    before: 'first\nconst result = condition\n  ? before()\n  : fallback()\nlast\n',
    after: 'first\nconst result = after()\nlast\n',
    line: 2,
    original: 'const result = condition\n',
    modified: 'const result = after()\n'
  },
  {
    name: 'an added line without a corresponding removed line',
    before: 'first\nold second\nlast\n',
    after: 'first\nnew second\nnew third\nlast\n',
    line: 3,
    original: '',
    modified: 'new third\n'
  }
])('limits the blame preview to $name in working and committed revisions', async (example) => {
  const { root, git, query } = await fixture()
  await writeFile(join(root, 'file.ts'), example.before)
  await git('add', '.')
  await git('commit', '--quiet', '-m', 'Before replacement')
  const working = await query(example.after, { mode: 'detail', line: example.line })
  expect(working.detail?.original).toBe(example.original)
  expect(working.detail?.modified).toBe(example.modified)
  await writeFile(join(root, 'file.ts'), example.after)
  await git('add', '.')
  await git('commit', '--quiet', '-m', 'Replace lines')
  const committed = await query(example.after, { mode: 'detail', line: example.line })
  expect(committed.detail?.original).toBe(example.original)
  expect(committed.detail?.modified).toBe(example.modified)
  expect(committed.detail?.originalContent).toBe(example.before)
  expect(committed.detail?.modifiedContent).toBe(example.after)
})

it('does not navigate an inserted line to an unrelated neighbouring line', async () => {
  const { root, git, query } = await fixture()
  await writeFile(join(root, 'file.ts'), 'first\nsecond\n')
  await git('add', '.')
  await git('commit', '--quiet', '-m', 'Before insertion')
  const buffer = 'first\ninserted\nsecond\n'
  const working = await query(buffer, { mode: 'detail', line: 2 })
  expect(working.detail?.previousLine).toBeNull()
  expect(working.detail?.original).toBe('')
  expect(working.detail?.modified).toBe('inserted\n')
  await writeFile(join(root, 'file.ts'), buffer)
  await git('add', '.')
  await git('commit', '--quiet', '-m', 'Insert line')
  const committed = await query(buffer, { mode: 'detail', line: 2 })
  expect(committed.detail?.previousLine).toBeNull()
  expect(committed.detail?.message).toBe('Insert line')
})

it('retains attribution across a staged rename and follows the prior line through a committed rename', async () => {
  const { root, git, query } = await fixture()
  await writeFile(join(root, 'file.ts'), 'first\nsecond\nthird\n')
  await git('add', '.')
  await git('commit', '--quiet', '-m', 'Original path')
  await rename(join(root, 'file.ts'), join(root, 'renamed.ts'))
  await git('add', '-A')
  expect(
    (await query('first\nsecond\nthird\n', { filePath: 'renamed.ts' })).snapshot?.lines[1].summary
  ).toBe('Original path')
  await git('commit', '--quiet', '-m', 'Rename file')
  await writeFile(join(root, 'renamed.ts'), 'first\nchanged\nthird\n')
  await git('add', '.')
  await git('commit', '--quiet', '-m', 'Change line')
  const { detail } = await query('first\nchanged\nthird\n', {
    filePath: 'renamed.ts',
    mode: 'detail',
    line: 2
  })
  expect(detail?.original).toBe('second\n')
  expect(detail?.previousLine).toBe(2)
  expect(detail?.attribution.summary).toBe('Change line')
})

it('shows untracked and unborn files as uncommitted', async () => {
  const { query } = await fixture()
  expect((await query('new file')).snapshot?.lines.map((line) => line.commit)).toEqual([null])
})

it('navigates a historical path whose directory was renamed away', async () => {
  const { root, git, query } = await fixture()
  await mkdir(join(root, 'old'))
  await writeFile(join(root, 'old', 'file.ts'), 'before\n')
  await git('add', '.')
  await git('commit', '--quiet', '-m', 'Before change')
  await writeFile(join(root, 'old', 'file.ts'), 'after\n')
  await git('add', '.')
  await git('commit', '--quiet', '-m', 'After change')
  const parent = await git('rev-parse', 'HEAD^')
  await rename(join(root, 'old'), join(root, 'new'))
  await git('add', '-A')
  await git('commit', '--quiet', '-m', 'Move directory')
  const { detail } = await query('', {
    filePath: 'old/file.ts',
    mode: 'detail',
    revision: parent,
    line: 1
  })
  expect(detail?.attribution.summary).toBe('Before change')
  expect(detail?.modifiedContent).toBe('before\n')
})

it('retains history for a deleted path and refreshes attribution after a new commit', async () => {
  const { root, git, query } = await fixture()
  await writeFile(join(root, 'file.ts'), 'before\n')
  await git('add', '.')
  await git('commit', '--quiet', '-m', 'Before change')
  await query('before\n')
  await writeFile(join(root, 'file.ts'), 'after\n')
  await git('add', '.')
  await git('commit', '--quiet', '-m', 'After change')
  expect((await query('after\n')).snapshot?.lines[0].summary).toBe('After change')
  await git('rm', '--quiet', 'file.ts')
  expect((await query('after\n')).snapshot?.lines[0].summary).toBe('After change')
})

it('works from a folder workspace containing a nested repository', async () => {
  const { root, git } = await fixture()
  await mkdir(join(root, 'nested'))
  await writeFile(join(root, 'nested', 'file.ts'), 'nested line\n')
  await git('add', '.')
  await git('commit', '--quiet', '-m', 'Nested line')
  const { snapshot } = await queryGitBlame(dirname(root), {
    channel: randomUUID(),
    sequence: 1,
    mode: 'snapshot',
    filePath: `${basename(root)}/nested/file.ts`,
    bufferContent: 'nested line\n'
  })
  expect(snapshot?.lines[0].summary).toBe('Nested line')
})
