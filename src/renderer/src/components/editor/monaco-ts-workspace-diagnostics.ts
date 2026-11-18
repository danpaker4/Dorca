import type * as Monaco from 'monaco-editor'
import { useAppStore } from '@/store'
import { queryHostTypeScriptDocument } from './monaco-ts-host-navigation'
import type { ModelWorkspaceContext } from './monaco-ts-workspace-models'

const DIAGNOSTIC_DELAY_MS = 300
const MARKER_OWNER = 'workspace-typescript'

export function attachWorkspaceTypeScriptDiagnostics(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
  model: Monaco.editor.ITextModel,
  context: ModelWorkspaceContext
): () => void {
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let queued = false
  let generation = 0
  const isActive = (state: ReturnType<typeof useAppStore.getState>): boolean =>
    state.activeWorktreeId === context.worktreeId &&
    state.activeFileId === context.fileId &&
    state.activeTabType === 'editor'
  const canCheck = (): boolean =>
    !disposed &&
    !model.isDisposed() &&
    editor.getModel() === model &&
    isActive(useAppStore.getState())

  async function check(): Promise<void> {
    if (running || !queued || !canCheck()) {
      return
    }
    queued = false
    running = true
    const current = generation
    try {
      const result = await queryHostTypeScriptDocument(monaco, context, model, 'diagnostics')
      if (canCheck() && current === generation && result?.errors) {
        monaco.editor.setModelMarkers(
          model,
          MARKER_OWNER,
          result.errors.map((error) => ({
            ...error.range,
            message: error.message,
            code: error.code,
            source: 'ts',
            severity: monaco.MarkerSeverity.Error
          }))
        )
      }
    } catch {
      // An unavailable host can recover on the next edit or editor activation.
    } finally {
      running = false
      void check()
    }
  }

  const invalidate = (): void => {
    generation++
    queued = false
    clearTimeout(timer)
  }
  const clearMarkers = (): void => {
    if (!model.isDisposed()) {
      monaco.editor.setModelMarkers(model, MARKER_OWNER, [])
    }
  }
  const schedule = (): void => {
    invalidate()
    if (canCheck()) {
      timer = setTimeout(() => {
        queued = true
        void check()
      }, DIAGNOSTIC_DELAY_MS)
    } else {
      clearMarkers()
    }
  }

  const change = model.onDidChangeContent(schedule)
  const unsubscribe = useAppStore.subscribe((state, previous) => {
    if (isActive(state) !== isActive(previous)) {
      schedule()
    }
  })
  schedule()
  return () => {
    disposed = true
    invalidate()
    clearMarkers()
    change.dispose()
    unsubscribe()
  }
}
