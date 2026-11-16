import type { RuntimeGitContext } from '@/runtime/source-control/git/runtime-git-client-context'
import { getRuntimeGitBlame } from '@/runtime/source-control/git/runtime-git-blame-client'
import { createNonSecureContextUuid } from '../../../../../shared/identifiers/non-secure-context-uuid'
import type { GitDiffTextResult } from '../../../../../shared/git/diff/git-diff-compare-types'

export async function readBlameCommitDiff(
  context: RuntimeGitContext,
  args: { commitOid: string; blameLine: number; filePath: string }
): Promise<GitDiffTextResult> {
  const { detail } = await getRuntimeGitBlame(context, {
    channel: createNonSecureContextUuid(),
    sequence: 1,
    mode: 'detail',
    revision: args.commitOid,
    line: args.blameLine,
    filePath: args.filePath
  })
  if (!detail || detail.attribution.commit !== args.commitOid) {
    throw new Error('The selected line revision is unavailable.')
  }
  return {
    kind: 'text',
    originalContent: detail.originalContent,
    modifiedContent: detail.modifiedContent,
    originalIsBinary: false,
    modifiedIsBinary: false
  }
}
