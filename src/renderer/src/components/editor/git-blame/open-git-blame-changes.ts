import type { AppState } from '@/store/types'
import { joinPath } from '@/lib/path'
import type { InlineGitContext } from '../git-inline/inline-git-context'
import type { GitBlameDetail } from '../../../../../shared/git/blame/git-blame'

export function openGitBlameChanges({
  state,
  context,
  detail,
  language,
  runtimeEnvironmentId
}: {
  state: Pick<AppState, 'openDiff' | 'openCommitDiff'>
  context: InlineGitContext
  detail: GitBlameDetail
  language: string
  runtimeEnvironmentId?: string | null
}): void {
  const options = { preview: false, executionHostId: context.hostId, runtimeEnvironmentId }
  const path = detail.attribution.path
  const commit = detail.attribution.commit
  if (!commit) {
    state.openDiff(
      context.worktreeId,
      joinPath(context.worktreePath, path),
      path,
      language,
      false,
      options
    )
    return
  }
  state.openCommitDiff(
    context.worktreeId,
    context.worktreePath,
    {
      path,
      oldPath: detail.previousPath !== path ? detail.previousPath : undefined,
      status: detail.parent ? 'modified' : 'added'
    },
    {
      commitOid: commit,
      parentOid: detail.parent,
      compareRef: commit.slice(0, 8),
      baseRef: detail.parent?.slice(0, 8) ?? 'empty-tree',
      blameLine: detail.attribution.originalLine
    },
    language,
    options
  )
}
