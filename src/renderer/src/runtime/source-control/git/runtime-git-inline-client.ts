import type {
  GitInlineHunkAction,
  GitInlineSnapshot
} from '../../../../../shared/git/diff/git-inline-hunks'
import type { RuntimeGitContext } from './runtime-git-client-context'
import { callRuntimeRpc } from '../../rpc/calls/runtime-rpc-call'
import { toRuntimeWorktreeSelector } from '../../rpc/targets/runtime-worktree-selector'

export function getRuntimeGitInlineSnapshot(
  context: RuntimeGitContext,
  filePath: string
): Promise<GitInlineSnapshot> {
  if (!context.worktreeId) {
    throw new Error('This file has no workspace owner.')
  }
  return callRuntimeRpc(
    context.target,
    'git.inlineSnapshot',
    {
      worktree: toRuntimeWorktreeSelector(context.worktreeId),
      filePath
    },
    { timeoutMs: 15000 }
  )
}

export function applyRuntimeGitInlineHunk(
  context: RuntimeGitContext,
  action: GitInlineHunkAction
): Promise<void> {
  if (!context.worktreeId) {
    throw new Error('This file has no workspace owner.')
  }
  return callRuntimeRpc(
    context.target,
    'git.applyInlineHunk',
    {
      worktree: toRuntimeWorktreeSelector(context.worktreeId),
      ...action
    },
    { timeoutMs: 15000 }
  )
}
