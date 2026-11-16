import { expect, it } from 'vitest'
import { createEditorTabsStore } from '@/store/slices/editor/editor-slice-test-harness'
import { makeWorktree } from '@/store/slices/worktrees/worktree.test-fixture'
import { openGitBlameChanges } from './open-git-blame-changes'

it('opens a permanent historical file diff tab and keeps the working file open', () => {
  const store = createEditorTabsStore()
  store.setState({
    worktreesByRepo: {
      'repo-1': [makeWorktree({ id: 'wt-1', repoId: 'repo-1', path: '/repo', hostId: 'local' })]
    }
  })
  store.getState().openFile(
    {
      filePath: '/repo/current.ts',
      relativePath: 'current.ts',
      worktreeId: 'wt-1',
      language: 'typescript',
      mode: 'edit'
    },
    { preview: false }
  )
  openGitBlameChanges({
    state: store.getState(),
    context: {
      target: { kind: 'local' },
      worktreeId: 'wt-1',
      worktreePath: '/repo',
      hostId: 'local'
    },
    language: 'typescript',
    runtimeEnvironmentId: null,
    detail: {
      attribution: {
        line: 12,
        originalLine: 8,
        path: 'historical.ts',
        author: 'Alice',
        email: '',
        timestamp: 0,
        commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        summary: 'Change'
      },
      parent: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      previousPath: 'before.ts',
      previousLine: 7,
      message: 'Change',
      committer: 'Alice',
      committedAt: 0,
      original: 'before\n',
      modified: 'after\n',
      originalContent: 'before\n',
      modifiedContent: 'after\n'
    }
  })
  expect(store.getState().openFiles.map((file) => [file.relativePath, file.mode])).toEqual([
    ['current.ts', 'edit'],
    ['historical.ts', 'diff']
  ])
  const diff = store.getState().openFiles[1]
  expect(diff).toMatchObject({
    filePath: '/repo/historical.ts',
    diffSource: 'commit',
    branchOldPath: 'before.ts',
    commitCompare: {
      commitOid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      parentOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      blameLine: 8
    }
  })
  expect(diff.isPreview).toBeFalsy()
})
