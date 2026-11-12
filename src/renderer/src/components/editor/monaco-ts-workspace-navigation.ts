import type * as Monaco from 'monaco-editor'
import { useAppStore } from '@/store'
import { listRuntimeFiles } from '@/runtime/files/search/runtime-file-search-client'
import { readRuntimeFileContent } from '@/runtime/files/reads/runtime-file-read-client'
import { computeRelativePath } from './monaco-ts-workspace-imports'
import { toEditorModelUri } from './model-lifetime/identity/editor-model-uri'
import {
  resolveModelContext,
  registerTargetUriContext,
  ensureCandidateFileModel,
  modelContextByUri
} from './monaco-ts-workspace-models'
import {
  isInsideProject,
  normalizeProjectPath,
  type TypeScriptProjectWorker
} from './monaco-ts-project-protocol'

const MAX_INVENTORY_FILES = 100_000
const MAX_READ_FILES = 20_000
const MAX_SOURCE_BYTES = 64 * 1024 * 1024

export async function queryWorkspaceSymbol(
  monaco: Pick<typeof Monaco, 'editor' | 'Uri'>,
  model: Monaco.editor.ITextModel,
  position: Monaco.IPosition,
  token: Monaco.CancellationToken,
  kind: 'definition' | 'references',
  includeDeclaration = true
): Promise<Monaco.languages.Location[] | null> {
  const ctx = resolveModelContext(model.uri.toString())
  if (!ctx) {
    return null
  }
  const version = model.getVersionId()
  const buffers = new Map<Monaco.editor.ITextModel, number>([[model, version]])
  const cancelled = (): boolean =>
    token.isCancellationRequested ||
    [...buffers].some(([buffer, stamp]) => buffer.isDisposed() || buffer.getVersionId() !== stamp)
  const root = normalizeProjectPath(ctx.projectRootPath ?? ctx.worktreePath)
  const worker = monaco.editor.createWebWorker<TypeScriptProjectWorker>({
    worker: new Worker(new URL('./monaco-ts-workspace.worker.ts', import.meta.url), {
      type: 'module',
      name: 'typescript-workspace'
    })
  })
  try {
    ctx.assertAuthorityCurrent()
    const inventory = await listRuntimeFiles(ctx.readContext, {
      rootPath: root,
      includeIgnored: false,
      allowLegacyIncludeIgnored: true,
      maxResults: MAX_INVENTORY_FILES + 1
    })
    ctx.assertAuthorityCurrent()
    if (cancelled() || inventory.length > MAX_INVENTORY_FILES) {
      return []
    }
    const fileNames = inventory
      .map((name) =>
        normalizeProjectPath(
          /^(?:\/|[a-z]:[\\/])/i.test(name)
            ? name
            : `${ctx.readContext.target.kind === 'environment' ? ctx.worktreePath : root}/${name}`
        )
      )
      .filter((name) => isInsideProject(root, name))
    const files: Record<string, string | null> = {}
    const state = useAppStore.getState()
    const paths = new Set(
      (state.openFiles ?? [])
        .filter(
          (file) =>
            file.worktreeId === ctx.worktreeId &&
            (file.runtimeEnvironmentId ?? null) === (ctx.runtimeEnvironmentId ?? null)
        )
        .map((file) => file.filePath)
    )
    const keptViews = new Set(
      Object.values(state.editorBufferKept ?? {}).flatMap((entry) => entry.viewIds)
    )
    for (const candidate of modelContextByUri.values()) {
      if (
        candidate.worktreeId !== ctx.worktreeId ||
        candidate.modelOwnerKey !== ctx.modelOwnerKey ||
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
    for (const filePath of paths) {
      const path = normalizeProjectPath(filePath)
      if (!isInsideProject(root, path)) {
        continue
      }
      const buffer = monaco.editor.getModel(
        monaco.Uri.parse(toEditorModelUri(filePath, ctx.modelOwnerKey))
      )
      if (buffer) {
        buffers.set(buffer, buffer.getVersionId())
        files[path] = buffer.getValue()
        fileNames.push(path)
      }
    }
    files[normalizeProjectPath(ctx.filePath)] = model.getValue()
    const proxy = await worker.getProxy()
    let bytes = Object.values(files).reduce(
      (total, content) => total + (content?.length ?? 0) * 2,
      0
    )
    if (bytes > MAX_SOURCE_BYTES) {
      return []
    }
    for (let round = 0; round < 32; round++) {
      if (cancelled()) {
        return []
      }
      ctx.assertAuthorityCurrent()
      const result = await proxy.query({
        rootPath: root,
        filePath: ctx.filePath,
        offset: model.getOffsetAt(position),
        kind,
        includeDeclaration,
        fileNames,
        files
      })
      if (cancelled()) {
        return []
      }
      ctx.assertAuthorityCurrent()
      const missing = result.missingFiles.filter(
        (name) => isInsideProject(root, normalizeProjectPath(name)) && !(name in files)
      )
      if (missing.length === 0 || (kind === 'definition' && result.locations.length > 0)) {
        await Promise.all(
          [...new Set(result.locations.map((entry) => entry.filePath))].map((filePath) =>
            ensureCandidateFileModel(
              monaco,
              ctx,
              filePath,
              files[normalizeProjectPath(filePath)] ?? undefined
            )
          )
        )
        if (cancelled()) {
          return []
        }
        return result.locations.map(({ filePath, range }) => ({
          uri: monaco.Uri.parse(registerTargetUriContext(ctx, filePath)),
          range
        }))
      }
      if (Object.keys(files).length + missing.length > MAX_READ_FILES) {
        return []
      }
      for (let start = 0; start < missing.length; start += 16) {
        if (cancelled()) {
          return []
        }
        await Promise.all(
          missing.slice(start, start + 16).map(async (filePath) => {
            try {
              ctx.assertAuthorityCurrent()
              const result = await readRuntimeFileContent({
                ...ctx.readContext,
                worktreeId: ctx.worktreeId,
                filePath,
                relativePath: computeRelativePath(ctx.worktreePath, filePath)
              })
              ctx.assertAuthorityCurrent()
              const content =
                !result.isBinary && typeof result.content === 'string' ? result.content : null
              files[filePath] = content
              bytes += (content?.length ?? 0) * 2
            } catch {
              files[filePath] = null
            }
          })
        )
        if (bytes > MAX_SOURCE_BYTES) {
          return []
        }
      }
    }
    return []
  } catch {
    return []
  } finally {
    worker.dispose()
  }
}
