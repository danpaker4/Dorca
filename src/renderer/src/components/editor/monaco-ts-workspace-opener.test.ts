// @vitest-environment happy-dom
import type * as Monaco from 'monaco-editor'
import { URI } from 'monaco-editor/esm/vs/base/common/uri.js'
import { afterEach, expect, it, vi } from 'vitest'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { AppState } from '@/store/types'
import {
  installWorkspaceNavigationHistory,
  navigateWorkspaceHistory,
  registerEditorForNavigationHistory
} from '@/lib/workspace-navigation-history'
import { registerWorkspaceEditorOpener } from './monaco-ts-workspace-opener'
import { modelContextByUri } from './monaco-ts-workspace-models'

type NavigationState = Pick<
  AppState,
  | 'activeWorktreeId'
  | 'activeTabType'
  | 'activeFileId'
  | 'activeFileIdByWorktree'
  | 'activeGroupIdByWorktree'
  | 'groupsByWorktree'
  | 'unifiedTabsByWorktree'
  | 'tabsByWorktree'
  | 'tabBarOrderByWorktree'
  | 'editorCursorLine'
  | 'openFiles'
  | 'openFile'
  | 'pendingEditorReveal'
  | 'setPendingEditorReveal'
>
const holder = vi.hoisted((): { store?: StoreApi<NavigationState> } => ({}))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => holder.store!.getState(),
    subscribe: (listener: (state: NavigationState) => void) => holder.store!.subscribe(listener)
  }
}))
vi.mock('@/components/terminal-workspace-model', () => ({ getKeybindingContext: () => 'editor' }))
vi.mock('@/hooks/ipc-tab-switch', () => ({ activateCyclableTab: vi.fn() }))

afterEach(() => {
  modelContextByUri.clear()
  vi.unstubAllGlobals()
})

it('steps directly between definition jump locations without visiting the file opening position', () => {
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  vi.stubGlobal('cancelAnimationFrame', () => {})
  const flushFrames = (): void => {
    while (frames.length) {
      frames.shift()!(0)
    }
  }
  const store = createStore<NavigationState>()((set) => ({
    activeWorktreeId: 'definition-history',
    activeTabType: 'editor',
    activeFileId: '/repo/source.ts',
    activeFileIdByWorktree: { 'definition-history': '/repo/source.ts' },
    activeGroupIdByWorktree: {},
    groupsByWorktree: {},
    unifiedTabsByWorktree: {},
    tabsByWorktree: {},
    tabBarOrderByWorktree: {},
    editorCursorLine: { '/repo/source.ts': 80 },
    pendingEditorReveal: null,
    openFiles: [
      {
        id: '/repo/source.ts',
        filePath: '/repo/source.ts',
        relativePath: 'source.ts',
        worktreeId: 'definition-history',
        language: 'typescript',
        isDirty: false,
        mode: 'edit'
      }
    ],
    openFile: (file) => {
      set((state) => ({
        openFiles: [
          ...state.openFiles.filter((open) => open.id !== file.filePath),
          { ...file, id: file.filePath, isDirty: false, mode: file.mode ?? 'edit' }
        ],
        activeFileId: file.filePath,
        activeFileIdByWorktree: { 'definition-history': file.filePath }
      }))
      return file.filePath
    },
    setPendingEditorReveal: (pendingEditorReveal) => set({ pendingEditorReveal })
  }))
  holder.store = store
  const sourceUri = URI.file('/repo/source.ts')
  modelContextByUri.set(sourceUri.toString(), {
    filePath: '/repo/source.ts',
    relativePath: 'source.ts',
    worktreeId: 'definition-history',
    worktreePath: '/repo',
    readContext: {
      target: { kind: 'local' },
      worktreeId: 'definition-history',
      worktreePath: '/repo'
    },
    assertAuthorityCurrent() {}
  })
  modelContextByUri.set(URI.file('/repo/definition.ts').toString(), {
    ...modelContextByUri.get(sourceUri.toString())!,
    filePath: '/repo/definition.ts',
    relativePath: 'definition.ts'
  })
  let opener: Monaco.editor.ICodeEditorOpener | undefined
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: opener registration only reads editor.registerEditorOpener.
  registerWorkspaceEditorOpener({
    editor: {
      registerEditorOpener: (value: Monaco.editor.ICodeEditorOpener) => {
        opener = value
      }
    }
  } as typeof Monaco)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: history and definition jumps only read the three editor methods supplied here.
  const source = {
    getModel: () => ({ uri: sourceUri }),
    getPosition: () => ({ lineNumber: 80, column: 7 }),
    onDidChangeCursorPosition: () => ({ dispose() {} })
  } as unknown as Monaco.editor.IStandaloneCodeEditor
  const disposeEditor = registerEditorForNavigationHistory(
    '/repo/source.ts',
    '/repo/source.ts',
    'source.ts',
    'definition-history',
    undefined,
    source
  )
  const dispose = installWorkspaceNavigationHistory()
  try {
    opener!.openCodeEditor(source, URI.file('/repo/definition.ts'), { lineNumber: 120, column: 5 })
    flushFrames()
    expect(navigateWorkspaceHistory('back')).toBe(true)
    flushFrames()
    expect(store.getState().pendingEditorReveal).toMatchObject({
      filePath: '/repo/source.ts',
      line: 80,
      column: 7
    })
    expect(navigateWorkspaceHistory('back')).toBe(false)
    expect(navigateWorkspaceHistory('forward')).toBe(true)
    flushFrames()
    expect(store.getState().pendingEditorReveal).toMatchObject({
      filePath: '/repo/definition.ts',
      line: 120,
      column: 5
    })
  } finally {
    dispose()
    disposeEditor()
  }
})
