import type * as Monaco from 'monaco-editor'
import { useAppStore } from '@/store'
import type { RuntimeFileOperationArgs } from '@/runtime/files/runtime-file-client-types'
import { readRuntimeFileContent } from '@/runtime/files/reads/runtime-file-read-client'
import { toEditorModelUri } from './model-lifetime/identity/editor-model-uri'
import { computeRelativePath } from './monaco-ts-workspace-imports'
import { normalizeProjectPath } from './monaco-ts-project-protocol'
import { isKeptEditorBufferView } from '@/store/slices/editor/buffers/editor-buffer-kept'

export type ModelWorkspaceContext = {
  filePath: string
  fileId?: string
  relativePath: string
  worktreeId: string
  worktreePath: string
  modelOwnerKey?: string
  runtimeEnvironmentId?: string | null
  connectionId?: string
  readContext: RuntimeFileOperationArgs
  assertAuthorityCurrent: () => void
  projectRootPath?: string
}

export const modelContextByUri = new Map<string, ModelWorkspaceContext>()

const hydratedFileStamps = new Map<string, number>()

const HYDRATION_CACHE_TTL_MS = 15_000

export function isTsOrJsLanguageId(langId: string): boolean {
  return (
    langId === 'typescript' ||
    langId === 'javascript' ||
    langId === 'typescriptreact' ||
    langId === 'javascriptreact'
  )
}

function toMonacoTsLanguageId(filePath: string): 'typescript' | 'javascript' {
  const lower = filePath.toLowerCase()
  if (
    lower.endsWith('.js') ||
    lower.endsWith('.jsx') ||
    lower.endsWith('.mjs') ||
    lower.endsWith('.cjs')
  ) {
    return 'javascript'
  }
  return 'typescript'
}

export function resolveModelContext(modelUriStr: string): ModelWorkspaceContext | null {
  return modelContextByUri.get(modelUriStr) ?? null
}

export function registerTargetUriContext(
  parentCtx: ModelWorkspaceContext,
  candidateFilePath: string
): string {
  const targetUriStr = toEditorModelUri(candidateFilePath, parentCtx.modelOwnerKey)
  if (!modelContextByUri.has(targetUriStr)) {
    modelContextByUri.set(targetUriStr, {
      filePath: candidateFilePath,
      relativePath: computeRelativePath(parentCtx.worktreePath, candidateFilePath),
      worktreeId: parentCtx.worktreeId,
      worktreePath: parentCtx.worktreePath,
      modelOwnerKey: parentCtx.modelOwnerKey,
      runtimeEnvironmentId: parentCtx.runtimeEnvironmentId,
      connectionId: parentCtx.connectionId,
      readContext: parentCtx.readContext,
      assertAuthorityCurrent: parentCtx.assertAuthorityCurrent,
      projectRootPath: parentCtx.projectRootPath
    })
  }
  return targetUriStr
}

export async function ensureCandidateFileModel(
  monaco: Pick<typeof Monaco, 'editor' | 'Uri'>,
  parentCtx: ModelWorkspaceContext,
  candidateFilePath: string,
  snapshot?: string
): Promise<Monaco.editor.ITextModel | null> {
  const targetUriStr = registerTargetUriContext(parentCtx, candidateFilePath)
  const targetUri = monaco.Uri.parse(targetUriStr)
  const existingModel = monaco.editor.getModel(targetUri)
  const hasRetainedBuffer = (): boolean => {
    const state = useAppStore.getState()
    const fileId = modelContextByUri.get(targetUriStr)?.fileId
    return (
      (fileId !== undefined && isKeptEditorBufferView(state.editorBufferKept ?? {}, fileId)) ||
      (state.openFiles?.some(
        (file) =>
          file.worktreeId === parentCtx.worktreeId &&
          (file.runtimeEnvironmentId ?? null) === (parentCtx.runtimeEnvironmentId ?? null) &&
          normalizeProjectPath(file.filePath) === normalizeProjectPath(candidateFilePath)
      ) ??
        false)
    )
  }
  if (snapshot !== undefined) {
    if (existingModel && !hasRetainedBuffer() && existingModel.getValue() !== snapshot) {
      existingModel.setValue(snapshot)
    }
    return (
      existingModel ??
      monaco.editor.createModel(snapshot, toMonacoTsLanguageId(candidateFilePath), targetUri)
    )
  }
  const now = Date.now()
  const lastHydrated = hydratedFileStamps.get(targetUriStr) ?? 0

  if (existingModel && now - lastHydrated < HYDRATION_CACHE_TTL_MS) {
    return existingModel
  }

  if (existingModel && hasRetainedBuffer()) {
    hydratedFileStamps.set(targetUriStr, now)
    return existingModel
  }

  try {
    parentCtx.assertAuthorityCurrent()
    const fileRes = await readRuntimeFileContent({
      ...parentCtx.readContext,
      worktreeId: parentCtx.worktreeId,
      filePath: candidateFilePath,
      relativePath: computeRelativePath(parentCtx.worktreePath, candidateFilePath)
    })
    parentCtx.assertAuthorityCurrent()
    if (fileRes.isBinary || typeof fileRes.content !== 'string') {
      return existingModel
    }
    hydratedFileStamps.set(targetUriStr, now)
    const rechecked = monaco.editor.getModel(targetUri)
    if (rechecked) {
      if (!hasRetainedBuffer() && rechecked.getValue() !== fileRes.content) {
        rechecked.setValue(fileRes.content)
      }
      return rechecked
    }
    return monaco.editor.createModel(
      fileRes.content,
      toMonacoTsLanguageId(candidateFilePath),
      targetUri
    )
  } catch {
    return existingModel
  }
}
