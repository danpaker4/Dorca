import type * as Monaco from 'monaco-editor'
import { useAppStore } from '@/store'
import { listRuntimeFiles } from '@/runtime/files/search/runtime-file-search-client'
import { toEditorModelUri } from './model-lifetime/identity/editor-model-uri'
import {
  resolveModelContext,
  registerTargetUriContext,
  ensureCandidateFileModel,
  modelContextByUri
} from './monaco-ts-workspace-models'
import { isInsideProject, normalizeProjectPath } from './monaco-ts-project-protocol'
import { acquireNavigationSession, releaseNavigationSession } from './monaco-ts-navigation-session'
import { loadProjectSnapshots } from './monaco-ts-project-snapshots'
import { ReferenceCandidates } from './monaco-ts-reference-candidates'
import { queryHostTypeScriptNavigation } from './monaco-ts-host-navigation'
import type { TypeScriptNavigationLocation } from '../../../../shared/editor-language/typescript-navigation'
import type { ModelWorkspaceContext } from './monaco-ts-workspace-models'

const MAX_INVENTORY_FILES = 100_000
const MAX_SOURCE_BYTES = 128 * 1024 * 1024

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
  const bufferFilePaths = new Map<Monaco.editor.ITextModel, string>([[model, ctx.filePath]])
  const bufferPaths = new Set([normalizeProjectPath(ctx.filePath)])
  const cancelled = (): boolean =>
    token.isCancellationRequested ||
    session.revision !== revision ||
    [...buffers].some(([buffer, stamp]) => buffer.isDisposed() || buffer.getVersionId() !== stamp)
  const root = normalizeProjectPath(ctx.projectRootPath ?? ctx.worktreePath)
  const session = acquireNavigationSession(monaco, model, ctx)
  const revision = session.revision
  try {
    ctx.assertAuthorityCurrent()
    const bufferNames: string[] = []
    const files: Record<string, string | null> = { ...session.files }
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
        bufferFilePaths.set(buffer, filePath)
        bufferPaths.add(path)
        files[path] = buffer.getValue()
        bufferNames.push(path)
      }
    }
    files[normalizeProjectPath(ctx.filePath)] = model.getValue()
    const native = await queryHostTypeScriptNavigation(ctx, {
      rootPath: ctx.projectRootPath ?? ctx.worktreePath,
      filePath: ctx.filePath,
      kind,
      lineNumber: position.lineNumber,
      column: position.column,
      includeDeclaration,
      buffers: [...bufferFilePaths].map(([buffer, filePath]) => ({
        filePath,
        content: buffer.getValue(),
        languageId: buffer.getLanguageId()
      }))
    })
    if (cancelled()) {
      return []
    }
    if (native) {
      return await materializeNavigationLocations(monaco, ctx, native.locations, files, cancelled)
    }
    const inventory =
      session.inventory ??
      (await listRuntimeFiles(ctx.readContext, {
        rootPath: root,
        includeIgnored: false,
        allowLegacyIncludeIgnored: true,
        maxResults: MAX_INVENTORY_FILES + 1
      }))
    ctx.assertAuthorityCurrent()
    if (cancelled() || inventory.length > MAX_INVENTORY_FILES) {
      return []
    }
    if (session.watching && session.revision === revision) {
      session.inventory = inventory
    }
    const fileNames = [
      ...inventory
        .map((name) =>
          normalizeProjectPath(
            /^(?:\/|[a-z]:[\\/])/i.test(name)
              ? name
              : `${ctx.readContext.target.kind === 'environment' ? ctx.worktreePath : root}/${name}`
          )
        )
        .filter((name) => isInsideProject(root, name)),
      ...bufferNames,
      ...session.existingPaths
    ]
    const candidates =
      kind === 'references'
        ? new ReferenceCandidates(
            ctx.readContext,
            root,
            [...bufferPaths],
            session.referenceSearches
          )
        : undefined
    await candidates?.expand([model.getWordAtPosition(position)?.word ?? ''])
    const proxy = await session.worker.getProxy()
    const knownNames = new Set(fileNames)
    if (
      Object.values(files).reduce((sum, content) => sum + (content?.length ?? 0) * 2, 0) >
      MAX_SOURCE_BYTES
    ) {
      return []
    }
    while (true) {
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
        files,
        ...candidates?.request
      })
      if (cancelled()) {
        return []
      }
      ctx.assertAuthorityCurrent()
      const missing = result.missingFiles.filter(
        (name) => isInsideProject(root, normalizeProjectPath(name)) && !(name in files)
      )
      const missingPaths = result.missingPaths.filter(
        (name) =>
          isInsideProject(root, normalizeProjectPath(name)) &&
          !(name in files) &&
          !knownNames.has(name)
      )
      if (
        (missing.length === 0 && missingPaths.length === 0) ||
        (kind === 'definition' && result.locations.length > 0)
      ) {
        if (await candidates?.expand(result.referenceNames)) {
          continue
        }
        return await materializeNavigationLocations(monaco, ctx, result.locations, files, cancelled)
      }
      const loaded = await loadProjectSnapshots({
        context: ctx.readContext,
        files,
        paths: missing,
        existencePaths: missingPaths,
        knownNames,
        maxSourceBytes: MAX_SOURCE_BYTES,
        isCurrent: () => {
          ctx.assertAuthorityCurrent()
          return !cancelled()
        },
        onSnapshot: (filePath, content) => {
          if (session.watching && session.revision === revision) {
            session.files[filePath] = content
          }
        },
        onExistingPath: (filePath) => {
          knownNames.add(filePath)
          fileNames.push(filePath)
          if (session.watching && session.revision === revision) {
            session.existingPaths.add(filePath)
          }
        }
      })
      if (!loaded) {
        return []
      }
    }
  } catch {
    return []
  } finally {
    releaseNavigationSession(session)
  }
}

async function materializeNavigationLocations(
  monaco: Pick<typeof Monaco, 'editor' | 'Uri'>,
  ctx: ModelWorkspaceContext,
  locations: TypeScriptNavigationLocation[],
  files: Record<string, string | null>,
  cancelled: () => boolean
): Promise<Monaco.languages.Location[]> {
  ctx.assertAuthorityCurrent()
  await Promise.all(
    [...new Set(locations.map((entry) => entry.filePath))].map((filePath) =>
      ensureCandidateFileModel(
        monaco,
        ctx,
        filePath,
        files[normalizeProjectPath(filePath)] ?? undefined
      )
    )
  )
  ctx.assertAuthorityCurrent()
  if (cancelled()) {
    return []
  }
  return locations.map(({ filePath, range }) => ({
    uri: monaco.Uri.parse(registerTargetUriContext(ctx, filePath)),
    range
  }))
}
