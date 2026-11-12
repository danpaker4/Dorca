import type * as Monaco from 'monaco-editor'
import { subscribeRuntimeFileChanges } from '@/runtime/files/watching/runtime-file-watch-client'
import { TS_WORKER_IDLE_STOP_MS } from '@/lib/editor/monaco/monaco-ts-worker-idle-stop'
import type { ModelWorkspaceContext } from './monaco-ts-workspace-models'
import { normalizeProjectPath, type TypeScriptProjectWorker } from './monaco-ts-project-protocol'

type NavigationSession = {
  context: ModelWorkspaceContext
  worker: Monaco.editor.MonacoWebWorker<TypeScriptProjectWorker>
  files: Record<string, string | null>
  existingPaths: Set<string>
  referenceSearches: Map<string, string[]>
  inventory?: string[]
  watching: boolean
  revision: number
  timer?: ReturnType<typeof setTimeout>
  dispose(): void
}

const sessions = new WeakMap<Monaco.editor.ITextModel, NavigationSession>()

export function acquireNavigationSession(
  monaco: Pick<typeof Monaco, 'editor'>,
  model: Monaco.editor.ITextModel,
  context: ModelWorkspaceContext
): NavigationSession {
  let session = sessions.get(model)
  if (session?.context !== context) {
    session?.dispose()
    session = undefined
  }
  if (!session) {
    let unsubscribe: (() => void) | undefined
    let worker: Monaco.editor.MonacoWebWorker<TypeScriptProjectWorker> | undefined
    const created: NavigationSession = {
      context,
      get worker() {
        worker ??= monaco.editor.createWebWorker<TypeScriptProjectWorker>({
          worker: new Worker(new URL('./monaco-ts-workspace.worker.ts', import.meta.url), {
            type: 'module',
            name: 'typescript-workspace'
          })
        })
        return worker
      },
      files: {},
      existingPaths: new Set(),
      referenceSearches: new Map(),
      watching: false,
      revision: 0,
      dispose() {
        if (sessions.get(model) !== created) {
          return
        }
        sessions.delete(model)
        clearTimeout(created.timer)
        unsubscribe?.()
        lifetime.dispose()
        worker?.dispose()
      }
    }
    const lifetime = model.onWillDispose(() => created.dispose())
    sessions.set(model, created)
    const invalidate = (): void => {
      created.files = {}
      created.existingPaths.clear()
      created.referenceSearches.clear()
      created.inventory = undefined
      created.revision++
    }
    void subscribeRuntimeFileChanges(
      context.readContext,
      (payload) => {
        if (
          normalizeProjectPath(payload.worktreePath) !==
            normalizeProjectPath(context.worktreePath) ||
          (context.readContext.target.kind !== 'environment' &&
            (payload.connectionId ?? null) !== (context.connectionId ?? null))
        ) {
          return
        }
        invalidate()
      },
      () => {
        created.watching = false
        invalidate()
      }
    )
      .then((stop) => {
        if (sessions.get(model) !== created) {
          stop()
        } else {
          unsubscribe = stop
          created.watching = true
        }
      })
      .catch(() => {
        created.watching = false
      })
    session = created
  }
  clearTimeout(session.timer)
  return session
}

export function releaseNavigationSession(session: NavigationSession): void {
  clearTimeout(session.timer)
  session.timer = setTimeout(() => session.dispose(), TS_WORKER_IDLE_STOP_MS)
}
