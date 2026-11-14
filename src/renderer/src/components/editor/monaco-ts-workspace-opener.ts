import type * as Monaco from 'monaco-editor'
import type { editor, IPosition, IRange } from 'monaco-editor'
import { URI } from 'monaco-editor/esm/vs/base/common/uri.js'
import { useAppStore } from '@/store'
import { getOpenedEditFileIdAfterOpen } from '@/store/slices/editor/file-ids/editor-file-ids'
import { scheduleEditorLineReveal } from '@/store/slices/editor/focus/editor-focus-reveal'
import { detectLanguage } from '../../../../shared/editor-language/editor-language-detect'
import {
  recordExplicitEditorJump,
  suppressWorkspaceHistoryRecording
} from '@/lib/workspace-navigation-history'
import { modelContextByUri, resolveModelContext } from './monaco-ts-workspace-models'
import { computeRelativePath } from './monaco-ts-workspace-imports'

export function registerWorkspaceEditorOpener(monaco: typeof Monaco): void {
  monaco.editor.registerEditorOpener({
    openCodeEditor(
      source: editor.ICodeEditor,
      resource: Monaco.Uri,
      selectionOrPosition?: IRange | IPosition
    ): boolean {
      const targetLine = selectionOrPosition
        ? 'startLineNumber' in selectionOrPosition
          ? selectionOrPosition.startLineNumber
          : selectionOrPosition.lineNumber
        : 1
      const targetColumn = selectionOrPosition
        ? 'startColumn' in selectionOrPosition
          ? selectionOrPosition.startColumn
          : selectionOrPosition.column
        : 1

      const sourceUriStr = source.getModel()?.uri.toString()
      const targetUriStr = resource.toString()
      const sourceCtx = sourceUriStr ? resolveModelContext(sourceUriStr) : null
      const sourcePos = source.getPosition() ?? { lineNumber: 1, column: 1 }

      if (sourceUriStr === targetUriStr) {
        if (sourceCtx) {
          recordExplicitEditorJump({
            worktreeId: sourceCtx.worktreeId,
            source: {
              filePath: sourceCtx.filePath,
              relativePath: sourceCtx.relativePath,
              runtimeEnvironmentId: sourceCtx.runtimeEnvironmentId,
              lineNumber: sourcePos.lineNumber,
              column: sourcePos.column
            },
            target: {
              filePath: sourceCtx.filePath,
              relativePath: sourceCtx.relativePath,
              runtimeEnvironmentId: sourceCtx.runtimeEnvironmentId,
              lineNumber: targetLine,
              column: targetColumn
            }
          })
        }
        source.setPosition({ lineNumber: targetLine, column: targetColumn })
        source.revealLineInCenterIfOutsideViewport(targetLine)
        source.focus()
        return true
      }

      const targetCtx = resolveModelContext(targetUriStr) ?? sourceCtx
      if (!targetCtx) {
        return false
      }

      const knownTarget = modelContextByUri.get(targetUriStr)
      const targetFilePath = knownTarget?.filePath ?? URI.file(URI.parse(targetUriStr).path).fsPath
      const targetRelativePath =
        knownTarget?.relativePath ?? computeRelativePath(targetCtx.worktreePath, targetFilePath)

      const state = useAppStore.getState()
      // Opening the target publishes its initial cursor before the explicit jump is recorded.
      suppressWorkspaceHistoryRecording()
      state.openFile(
        {
          filePath: targetFilePath,
          relativePath: targetRelativePath,
          worktreeId: targetCtx.worktreeId,
          language: detectLanguage(targetFilePath),
          mode: 'edit',
          runtimeEnvironmentId: targetCtx.runtimeEnvironmentId ?? undefined
        },
        {
          preview: true,
          targetGroupId: state.activeGroupIdByWorktree?.[targetCtx.worktreeId],
          recordReplacedPreview: true
        }
      )

      const fileId = getOpenedEditFileIdAfterOpen(
        useAppStore.getState(),
        targetFilePath,
        targetCtx.worktreeId
      )
      recordExplicitEditorJump({
        worktreeId: targetCtx.worktreeId,
        source: sourceCtx
          ? {
              filePath: sourceCtx.filePath,
              relativePath: sourceCtx.relativePath,
              runtimeEnvironmentId: sourceCtx.runtimeEnvironmentId,
              lineNumber: sourcePos.lineNumber,
              column: sourcePos.column
            }
          : undefined,
        target: {
          fileId,
          filePath: targetFilePath,
          relativePath: targetRelativePath,
          runtimeEnvironmentId: targetCtx.runtimeEnvironmentId,
          lineNumber: targetLine,
          column: targetColumn
        }
      })
      scheduleEditorLineReveal(
        () => useAppStore.getState(),
        targetFilePath,
        targetLine,
        targetColumn,
        fileId
      )
      return true
    }
  })
}
