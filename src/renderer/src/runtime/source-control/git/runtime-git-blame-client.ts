import type { GitBlameRequest, GitBlameResult } from '../../../../../shared/git/blame/git-blame'
import type { RuntimeGitContext } from './runtime-git-client-context'
import { callRuntimeRpc } from '../../rpc/calls/runtime-rpc-call'
import { toRuntimeWorktreeSelector } from '../../rpc/targets/runtime-worktree-selector'

export function getRuntimeGitBlame(
  context: RuntimeGitContext,
  request: GitBlameRequest,
  signal?: AbortSignal
): Promise<GitBlameResult> {
  if (!context.worktreeId) {
    throw new Error('This file has no workspace owner.')
  }
  return callRuntimeRpc(
    context.target,
    'git.blame',
    {
      ...request,
      worktree: toRuntimeWorktreeSelector(context.worktreeId)
    },
    { timeoutMs: 16000, signal }
  )
}
