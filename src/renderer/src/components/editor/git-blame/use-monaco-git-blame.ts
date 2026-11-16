import { useEffect, useMemo, useRef, useState } from 'react'
import { createNonSecureContextUuid } from '../../../../../shared/identifiers/non-secure-context-uuid'
import type { editor } from 'monaco-editor'
import { useAppStore } from '@/store'
import {
  selectWorktreesByRepo,
  selectFolderWorkspaces
} from '@/store/workspaces/catalog/workspace-record-fields'
import { useWorktreeGitCopyHostId } from '@/lib/workspace/ownership/worktree-git-copy'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import { getRuntimeGitBlame } from '@/runtime/source-control/git/runtime-git-blame-client'
import { statRuntimePath } from '@/runtime/files/metadata/runtime-file-metadata-client'
import { acquireEditorFileOperation } from '@/lib/editor/file-operations/editor-file-operation-owner'
import { resolveInlineGitContext } from '../git-inline/inline-git-context'
import type { GitBlameSnapshot } from '../../../../../shared/git/blame/git-blame'

export function useMonacoGitBlame(
  source: editor.IStandaloneCodeEditor | null,
  fileId: string,
  relativePath: string,
  enabled: boolean,
  revision?: string
) {
  const file = useAppStore((state) => state.openFiles.find((entry) => entry.id === fileId))
  const status = useAppStore((state) =>
    file?.worktreeId ? state.gitStatusByWorktree[file.worktreeId] : undefined
  )
  const hostId = useWorktreeGitCopyHostId(file?.worktreeId ?? null)
  const catalog = useAppStore(selectWorktreesByRepo)
  const folders = useAppStore(selectFolderWorkspaces)
  const context = useMemo(
    () =>
      enabled
        ? resolveInlineGitContext(
            file?.worktreeId,
            file?.runtimeEnvironmentId,
            hostId,
            catalog,
            folders
          )
        : null,
    [file?.worktreeId, file?.runtimeEnvironmentId, hostId, catalog, folders, enabled]
  )
  const identity = useMemo(
    () => JSON.stringify([fileId, relativePath, context, revision]),
    [fileId, relativePath, context, revision]
  )
  const [ownedSnapshot, setSnapshot] = useState<{
    snapshot: GitBlameSnapshot
    owner: string
    source: editor.IStandaloneCodeEditor
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [channel] = useState(createNonSecureContextUuid)
  const sequence = useRef(0)
  const refreshRef = useRef<() => void>(() => {})
  useEffect(() => {
    setSnapshot(null)
    setError(null)
    if (!source || !context) {
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    let active: AbortController | undefined
    let pending = false
    let disposed = false
    let editedAt: number | null = null
    const cancel = (): void => {
      if (!active || active.signal.aborted) {
        return
      }
      active.abort()
      void getRuntimeGitBlame(context, {
        mode: 'cancel',
        channel,
        sequence: ++sequence.current,
        filePath: relativePath
      }).catch(() => {})
    }
    const refresh = (): void => {
      if (disposed) {
        return
      }
      if (active) {
        pending = true
        return
      }
      const model = source.getModel()
      if (!model) {
        return
      }
      const captured = model.getAlternativeVersionId()
      const request = ++sequence.current
      active = new AbortController()
      void getRuntimeGitBlame(
        context,
        {
          mode: 'snapshot',
          channel,
          sequence: request,
          filePath: relativePath,
          bufferContent: model.getValue(),
          revision
        },
        active.signal
      )
        .then(async (result) => {
          const workingTime = result.snapshot?.lines.some((line) => !line.commit)
            ? await readWorkingTreeTimestamp(fileId, editedAt)
            : null
          if (
            !disposed &&
            request === sequence.current &&
            source.getModel() === model &&
            model.getAlternativeVersionId() === captured
          ) {
            setSnapshot(
              result.snapshot
                ? {
                    owner: identity,
                    source,
                    snapshot: {
                      ...result.snapshot,
                      lines: result.snapshot.lines.map((line) =>
                        line.commit ? line : { ...line, timestamp: workingTime }
                      )
                    }
                  }
                : null
            )
            setError(null)
          }
        })
        .catch((cause: unknown) => {
          if (!disposed && request === sequence.current) {
            setSnapshot(null)
            setError(cause instanceof Error ? cause.message : String(cause))
          }
        })
        .finally(() => {
          active = undefined
          if (pending && !disposed) {
            pending = false
            void refresh()
          }
        })
    }
    const invalidate = (): void => {
      editedAt = Date.now()
      cancel()
      setSnapshot(null)
      setVersion((old) => old + 1)
      clearTimeout(timer)
      timer = setTimeout(() => void refresh(), 500)
    }
    const content = source.onDidChangeModelContent(invalidate)
    const model = source.onDidChangeModel(invalidate)
    const interval = installWindowVisibilityInterval({
      run: () => void refresh(),
      intervalMs: 15000,
      slowWhileUnfocused: true
    })
    const refreshNow = (): void => {
      void refresh()
    }
    refreshRef.current = refreshNow
    void refresh()
    return () => {
      disposed = true
      clearTimeout(timer)
      content.dispose()
      model.dispose()
      interval()
      cancel()
      if (refreshRef.current === refreshNow) {
        refreshRef.current = () => {}
      }
    }
  }, [source, context, relativePath, channel, fileId, identity, revision])
  useEffect(() => {
    refreshRef.current()
  }, [status])
  const snapshot =
    ownedSnapshot?.owner === identity && ownedSnapshot.source === source
      ? ownedSnapshot.snapshot
      : null
  return { snapshot, error, context, file, version }
}

async function readWorkingTreeTimestamp(
  fileId: string,
  editedAt: number | null
): Promise<number | null> {
  if (editedAt !== null) {
    return editedAt
  }
  try {
    const file = useAppStore.getState().openFiles.find((entry) => entry.id === fileId)
    if (file) {
      const operation = acquireEditorFileOperation(useAppStore.getState, file)
      const stat = await statRuntimePath(operation.context, file.filePath)
      operation.assertAuthorityCurrent()
      return Number.isFinite(stat.mtime) && stat.mtime > 0 ? stat.mtime : null
    }
  } catch {
    // Missing or inaccessible files can still show blame for the current buffer.
  }
  return null
}
