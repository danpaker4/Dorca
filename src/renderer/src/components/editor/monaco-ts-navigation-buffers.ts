import type * as Monaco from 'monaco-editor'
import { useAppStore } from '@/store'
import { toEditorModelUri } from './model-lifetime/identity/editor-model-uri'
import { modelContextByUri, type ModelWorkspaceContext } from './monaco-ts-workspace-models'
import { isInsideProject, normalizeProjectPath } from './monaco-ts-project-protocol'

export function captureNavigationBuffers(
  monaco: Pick<typeof Monaco, 'editor' | 'Uri'>,
  context: ModelWorkspaceContext,
  model: Monaco.editor.ITextModel
): Map<Monaco.editor.ITextModel, string> {
  const buffers = new Map([[model, context.filePath]])
  const state = useAppStore.getState()
  const paths = new Set(
    (state.openFiles ?? [])
      .filter(
        (file) =>
          file.worktreeId === context.worktreeId &&
          (file.runtimeEnvironmentId ?? null) === (context.runtimeEnvironmentId ?? null)
      )
      .map((file) => file.filePath)
  )
  const keptViews = new Set(
    Object.values(state.editorBufferKept ?? {}).flatMap((entry) => entry.viewIds)
  )
  for (const candidate of modelContextByUri.values()) {
    if (
      candidate.worktreeId !== context.worktreeId ||
      candidate.modelOwnerKey !== context.modelOwnerKey ||
      !candidate.fileId ||
      !keptViews.has(candidate.fileId)
    ) {
      continue
    }
    try {
      candidate.assertAuthorityCurrent()
      paths.add(candidate.filePath)
    } catch {
      continue
    }
  }
  const root = normalizeProjectPath(context.projectRootPath ?? context.worktreePath)
  for (const filePath of paths) {
    if (!isInsideProject(root, normalizeProjectPath(filePath))) {
      continue
    }
    const buffer = monaco.editor.getModel(
      monaco.Uri.parse(toEditorModelUri(filePath, context.modelOwnerKey))
    )
    if (buffer) {
      buffers.set(buffer, filePath)
    }
  }
  return buffers
}
