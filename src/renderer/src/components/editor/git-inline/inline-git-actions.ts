import { Range, type editor } from 'monaco-editor'
import { useAppStore } from '@/store'
import { refreshGitStatusForWorktree } from '@/components/right-sidebar/source-control/sync/git-status-refresh'
import {
  applyRuntimeGitInlineHunk,
  getRuntimeGitInlineSnapshot
} from '@/runtime/source-control/git/runtime-git-inline-client'
import {
  normalizeGitEditorText,
  type GitInlineHunk,
  type GitInlineSnapshot
} from '../../../../../shared/git/diff/git-inline-hunks'
import type { InlineGitContext } from './inline-git-context'

export async function runInlineGitAction({
  source,
  change,
  snapshot,
  context,
  buffer,
  relativePath,
  revert
}: {
  source: editor.IStandaloneCodeEditor
  change: { hunk: GitInlineHunk; staged: boolean; hunkIndex: number }
  snapshot: GitInlineSnapshot
  context: InlineGitContext
  buffer: string
  relativePath: string
  revert: boolean
}): Promise<void> {
  const model = source.getModel()
  if (!model || normalizeGitEditorText(model.getValue()) !== buffer) {
    throw new Error('This editor change is stale. Reopen the inline diff and try again.')
  }
  const version = model.getVersionId()
  if (revert) {
    const latest = await getRuntimeGitInlineSnapshot(context, relativePath)
    if (
      latest.token !== snapshot.token ||
      model.isDisposed() ||
      source.getModel() !== model ||
      model.getVersionId() !== version
    ) {
      throw new Error('This change is stale. Reopen the inline diff and try again.')
    }
    const positionAt = (offset: number): { lineNumber: number; column: number } => {
      const prefix = buffer.slice(0, offset)
      return { lineNumber: prefix.split('\n').length, column: offset - prefix.lastIndexOf('\n') }
    }
    source.pushUndoStop()
    source.executeEdits('git.revertHunk', [
      {
        range: Range.fromPositions(
          positionAt(change.hunk.modifiedStart),
          positionAt(change.hunk.modifiedEnd)
        ),
        text: change.hunk.originalText.replace(/\n/g, model.getEOL())
      }
    ])
    source.pushUndoStop()
    source.focus()
    return
  }
  await applyRuntimeGitInlineHunk(context, {
    filePath: relativePath,
    token: snapshot.token,
    staged: change.staged,
    hunkIndex: change.hunkIndex,
    bufferContent: buffer
  })
  await refreshGitStatusForWorktree({
    target: context.target,
    ownerHostId: context.hostId,
    worktreeId: context.worktreeId,
    worktreePath: context.worktreePath,
    connectionId: context.connectionId,
    deps: useAppStore.getState()
  })
}
