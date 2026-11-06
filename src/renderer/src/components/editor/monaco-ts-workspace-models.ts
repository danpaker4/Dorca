import type * as Monaco from 'monaco-editor'
import { URI } from 'monaco-editor/esm/vs/base/common/uri.js'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { selectWorktreesByRepo } from '@/store/workspace-record-selectors'
import { getConnectionId } from '@/lib/connection-context'
import { toEditorModelUri } from './model-lifetime/identity/editor-model-uri'
import { normalizeSlashes, computeRelativePath } from './monaco-ts-workspace-imports'

export type ModelWorkspaceContext = {
  filePath: string
  relativePath: string
  worktreeId: string
  worktreePath: string
  modelOwnerKey?: string
  runtimeEnvironmentId?: string | null
  connectionId?: string
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
  const existing = modelContextByUri.get(modelUriStr)
  if (existing) {
    return existing
  }
  const state = useAppStore.getState()
  const worktreesByRepo = selectWorktreesByRepo(state)
  for (const openFile of state.openFiles ?? []) {
    const worktree = findWorktreeById(worktreesByRepo, openFile.worktreeId)
    if (!worktree) {
      continue
    }
    const candidateUri = toEditorModelUri(openFile.filePath, '')
    const parsedUri = URI.parse(modelUriStr)
    if (
      candidateUri === modelUriStr ||
      normalizeSlashes(openFile.filePath).toLowerCase() ===
        normalizeSlashes(URI.file(parsedUri.path).fsPath).toLowerCase()
    ) {
      const ctx: ModelWorkspaceContext = {
        filePath: openFile.filePath,
        relativePath:
          openFile.relativePath || computeRelativePath(worktree.path, openFile.filePath),
        worktreeId: openFile.worktreeId,
        worktreePath: worktree.path,
        modelOwnerKey: '',
        runtimeEnvironmentId: openFile.runtimeEnvironmentId,
        connectionId: getConnectionId(openFile.worktreeId) ?? undefined
      }
      modelContextByUri.set(modelUriStr, ctx)
      return ctx
    }
  }
  return null
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
      connectionId: parentCtx.connectionId
    })
  }
  return targetUriStr
}

export async function ensureCandidateFileModel(
  monaco: typeof Monaco,
  parentCtx: ModelWorkspaceContext,
  candidateFilePath: string
): Promise<Monaco.editor.ITextModel | null> {
  const targetUriStr = registerTargetUriContext(parentCtx, candidateFilePath)
  const targetUri = monaco.Uri.parse(targetUriStr)
  const existingModel = monaco.editor.getModel(targetUri)
  const now = Date.now()
  const lastHydrated = hydratedFileStamps.get(targetUriStr) ?? 0

  if (existingModel && now - lastHydrated < HYDRATION_CACHE_TTL_MS) {
    return existingModel
  }

  const state = useAppStore.getState()
  const isOpenInTab = state.openFiles?.some(
    (f) =>
      f.worktreeId === parentCtx.worktreeId &&
      normalizeSlashes(f.filePath).toLowerCase() ===
        normalizeSlashes(candidateFilePath).toLowerCase()
  )
  if (existingModel && isOpenInTab) {
    hydratedFileStamps.set(targetUriStr, now)
    return existingModel
  }

  try {
    const fileRes = await window.api.fs.readFile({
      filePath: candidateFilePath,
      connectionId: parentCtx.connectionId
    })
    if (fileRes.isBinary || typeof fileRes.content !== 'string') {
      return existingModel
    }
    hydratedFileStamps.set(targetUriStr, now)
    const rechecked = monaco.editor.getModel(targetUri)
    if (rechecked) {
      if (!isOpenInTab && rechecked.getValue() !== fileRes.content) {
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
