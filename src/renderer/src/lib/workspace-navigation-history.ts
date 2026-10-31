import type { editor } from 'monaco-editor'
import { useAppStore } from '@/store'
import { getActiveTabNavOrder } from '@/components/tab-bar/group-tab-order'
import {
  getActiveEntityIdForTabType,
  type TabCycleType,
  type TypeCyclableTab
} from '@/components/terminal/tab-type-cycle'
import { activateCyclableTab } from '@/hooks/ipc-tab-switch'
import { getKeybindingContext } from '@/components/terminal-workspace-model'
import { addAppKeyListener, removeAppKeyListener } from './app-keyboard-router'
import { detectLanguage } from './language-detect'
import { getOpenedEditFileIdAfterOpen } from '@/store/slices/editor/file-ids/editor-file-ids'
import { scheduleEditorLineReveal } from '@/store/slices/editor/focus/editor-focus-reveal'

export type NavHistoryEntry =
  | {
      kind: 'editor'
      worktreeId: string
      fileId: string
      filePath: string
      relativePath: string
      runtimeEnvironmentId?: string | null
      tabId?: string
      lineNumber: number
      column: number
    }
  | {
      kind: 'tab'
      worktreeId: string
      tabType: Exclude<TabCycleType, 'editor'>
      entityId: string
      tabId?: string
    }

type WorktreeHistoryStack = {
  entries: NavHistoryEntry[]
  index: number
}

const MAX_HISTORY_ENTRIES = 100
const SAME_FILE_LINE_JUMP_THRESHOLD = 10

const historyByWorktreeId = new Map<string, WorktreeHistoryStack>()
const mountedEditorsByFileId = new Map<string, editor.IStandaloneCodeEditor>()

let isRestoringHistory = false
let suppressRecordingUntil = 0

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase()
}

export function suppressWorkspaceHistoryRecording(durationMs = 220): void {
  const until = performance.now() + durationMs
  if (until > suppressRecordingUntil) {
    suppressRecordingUntil = until
  }
}

function isRecordingSuppressed(): boolean {
  return isRestoringHistory || performance.now() < suppressRecordingUntil
}

function getOrCreateStack(worktreeId: string): WorktreeHistoryStack {
  let stack = historyByWorktreeId.get(worktreeId)
  if (!stack) {
    stack = { entries: [], index: -1 }
    historyByWorktreeId.set(worktreeId, stack)
  }
  return stack
}

function isSameTabTarget(a: NavHistoryEntry, b: NavHistoryEntry): boolean {
  if (a.worktreeId !== b.worktreeId || a.kind !== b.kind) {
    return false
  }
  if (a.kind === 'editor' && b.kind === 'editor') {
    return normalizePath(a.filePath) === normalizePath(b.filePath)
  }
  if (a.kind === 'tab' && b.kind === 'tab') {
    return a.tabType === b.tabType && a.entityId === b.entityId
  }
  return false
}

function isSameHistoryPoint(a: NavHistoryEntry, b: NavHistoryEntry): boolean {
  if (!isSameTabTarget(a, b)) {
    return false
  }
  if (a.kind === 'editor' && b.kind === 'editor') {
    return Math.abs(a.lineNumber - b.lineNumber) < SAME_FILE_LINE_JUMP_THRESHOLD
  }
  return true
}

function pushHistoryEntry(entry: NavHistoryEntry, forceDistinctLine = false): void {
  const stack = getOrCreateStack(entry.worktreeId)
  const current = stack.index >= 0 ? stack.entries[stack.index] : undefined

  if (current) {
    if (forceDistinctLine && current.kind === 'editor' && entry.kind === 'editor') {
      if (
        normalizePath(current.filePath) === normalizePath(entry.filePath) &&
        current.lineNumber === entry.lineNumber &&
        current.column === entry.column
      ) {
        return
      }
    } else if (isSameHistoryPoint(current, entry)) {
      if (current.kind === 'editor' && entry.kind === 'editor') {
        current.fileId = entry.fileId
        current.tabId = entry.tabId ?? current.tabId
        current.lineNumber = entry.lineNumber
        current.column = entry.column
      }
      return
    }
  }

  if (stack.index < stack.entries.length - 1) {
    stack.entries.splice(stack.index + 1)
  }
  stack.entries.push(entry)
  if (stack.entries.length > MAX_HISTORY_ENTRIES) {
    stack.entries.shift()
  }
  stack.index = stack.entries.length - 1
}

function resolveCurrentNavEntryFromStore(
  state: ReturnType<typeof useAppStore.getState>
): NavHistoryEntry | null {
  const worktreeId = state.activeWorktreeId
  if (!worktreeId) {
    return null
  }
  const allTabIds = getActiveTabNavOrder(state, worktreeId)
  const activeGroupId = state.activeGroupIdByWorktree?.[worktreeId]
  const group = activeGroupId
    ? (state.groupsByWorktree?.[worktreeId] ?? []).find((candidate) => candidate.id === activeGroupId)
    : undefined
  const groupTabIdInNav =
    group?.activeTabId && allTabIds.some((entry) => entry.tabId === group.activeTabId)
      ? group.activeTabId
      : null
  const activeTab = state.getActiveTab?.(worktreeId)
  const currentEntityId = getActiveEntityIdForTabType(
    state.activeTabType,
    state.activeTabId,
    state.activeFileId,
    state.activeBrowserTabId,
    activeTab?.contentType === 'agent-session' ? activeTab.entityId : null
  )
  const activeNavTab = groupTabIdInNav
    ? allTabIds.find((t) => t.tabId === groupTabIdInNav)
    : allTabIds.find((t) => t.type === state.activeTabType && t.id === currentEntityId)

  const effectiveType = activeNavTab?.type ?? state.activeTabType
  if (effectiveType === 'editor') {
    const fileId = activeNavTab?.id ?? state.activeFileId
    if (!fileId) {
      return null
    }
    const openFile =
      state.openFiles?.find((f) => f.id === fileId && f.worktreeId === worktreeId) ??
      state.openFiles?.find((f) => f.id === fileId)
    if (!openFile) {
      return null
    }
    const mountedEditor = mountedEditorsByFileId.get(openFile.id)
    const pos = mountedEditor?.getPosition()
    const lineNumber = pos?.lineNumber ?? state.editorCursorLineByFileId?.[openFile.id] ?? 1
    const column = pos?.column ?? 1
    return {
      kind: 'editor',
      worktreeId,
      fileId: openFile.id,
      filePath: openFile.filePath,
      relativePath: openFile.relativePath,
      runtimeEnvironmentId: openFile.runtimeEnvironmentId,
      tabId: activeNavTab?.tabId,
      lineNumber,
      column
    }
  }

  const entityId = activeNavTab?.id ?? currentEntityId
  if (!entityId) {
    return null
  }
  return {
    kind: 'tab',
    worktreeId,
    tabType: effectiveType,
    entityId,
    tabId: activeNavTab?.tabId
  }
}

export function registerEditorForNavigationHistory(
  fileId: string,
  filePath: string,
  relativePath: string,
  worktreeId: string | undefined,
  runtimeEnvironmentId: string | null | undefined,
  editorInstance: editor.IStandaloneCodeEditor
): () => void {
  mountedEditorsByFileId.set(fileId, editorInstance)

  if (worktreeId && !isRecordingSuppressed()) {
    const pos = editorInstance.getPosition()
    const stack = getOrCreateStack(worktreeId)
    const current = stack.index >= 0 ? stack.entries[stack.index] : undefined
    if (
      current?.kind === 'editor' &&
      normalizePath(current.filePath) === normalizePath(filePath)
    ) {
      current.fileId = fileId
      if (pos) {
        current.lineNumber = pos.lineNumber
        current.column = pos.column
      }
    } else if (pos) {
      pushHistoryEntry({
        kind: 'editor',
        worktreeId,
        fileId,
        filePath,
        relativePath,
        runtimeEnvironmentId,
        lineNumber: pos.lineNumber,
        column: pos.column
      })
    }
  }

  const cursorSub = editorInstance.onDidChangeCursorPosition((e) => {
    if (!worktreeId || isRecordingSuppressed()) {
      return
    }
    const stack = getOrCreateStack(worktreeId)
    const current = stack.index >= 0 ? stack.entries[stack.index] : undefined
    if (
      current?.kind === 'editor' &&
      normalizePath(current.filePath) === normalizePath(filePath)
    ) {
      if (Math.abs(e.position.lineNumber - current.lineNumber) >= SAME_FILE_LINE_JUMP_THRESHOLD) {
        pushHistoryEntry(
          {
            kind: 'editor',
            worktreeId,
            fileId,
            filePath,
            relativePath,
            runtimeEnvironmentId,
            tabId: current.tabId,
            lineNumber: e.position.lineNumber,
            column: e.position.column
          },
          true
        )
      } else {
        current.fileId = fileId
        current.lineNumber = e.position.lineNumber
        current.column = e.position.column
      }
    }
  })

  return () => {
    cursorSub.dispose()
    if (mountedEditorsByFileId.get(fileId) === editorInstance) {
      mountedEditorsByFileId.delete(fileId)
    }
  }
}

export function recordExplicitEditorJump(params: {
  worktreeId: string
  source?: {
    fileId?: string
    filePath: string
    relativePath: string
    runtimeEnvironmentId?: string | null
    lineNumber: number
    column: number
  }
  target: {
    fileId?: string
    filePath: string
    relativePath: string
    runtimeEnvironmentId?: string | null
    lineNumber: number
    column: number
  }
}): void {
  const { worktreeId, source, target } = params
  if (source) {
    pushHistoryEntry(
      {
        kind: 'editor',
        worktreeId,
        fileId: source.fileId ?? '',
        filePath: source.filePath,
        relativePath: source.relativePath,
        runtimeEnvironmentId: source.runtimeEnvironmentId,
        lineNumber: source.lineNumber,
        column: source.column
      },
      true
    )
  }
  pushHistoryEntry(
    {
      kind: 'editor',
      worktreeId,
      fileId: target.fileId ?? '',
      filePath: target.filePath,
      relativePath: target.relativePath,
      runtimeEnvironmentId: target.runtimeEnvironmentId,
      lineNumber: target.lineNumber,
      column: target.column
    },
    true
  )
  suppressWorkspaceHistoryRecording(260)
}

function syncCurrentEditorPositionBeforeStep(worktreeId: string): void {
  const stack = historyByWorktreeId.get(worktreeId)
  if (!stack || stack.index < 0) {
    return
  }
  const current = stack.entries[stack.index]
  if (current?.kind === 'editor') {
    const mounted = mountedEditorsByFileId.get(current.fileId)
    const pos = mounted?.getPosition()
    if (pos) {
      current.lineNumber = pos.lineNumber
      current.column = pos.column
    }
  }
}

function applyHistoryEntry(entry: NavHistoryEntry): boolean {
  const state = useAppStore.getState()
  const { worktreeId } = entry
  if (!worktreeId || state.activeWorktreeId !== worktreeId) {
    return false
  }

  if (entry.kind === 'editor') {
    const existingOpenFile =
      state.openFiles?.find(
        (f) =>
          f.worktreeId === worktreeId &&
          f.mode === 'edit' &&
          (f.id === entry.fileId || normalizePath(f.filePath) === normalizePath(entry.filePath))
      ) ??
      state.openFiles?.find(
        (f) => f.mode === 'edit' && normalizePath(f.filePath) === normalizePath(entry.filePath)
      )

    const allTabIds = getActiveTabNavOrder(state, worktreeId)
    const matchingNavTab = existingOpenFile
      ? allTabIds.find((t) => t.type === 'editor' && t.id === existingOpenFile.id)
      : undefined

    const alreadyActiveEditor =
      state.activeTabType === 'editor' &&
      existingOpenFile &&
      state.activeFileId === existingOpenFile.id

    if (alreadyActiveEditor) {
      const mounted = mountedEditorsByFileId.get(existingOpenFile.id)
      if (mounted) {
        mounted.setPosition({ lineNumber: entry.lineNumber, column: entry.column })
        mounted.revealLineInCenterIfOutsideViewport(entry.lineNumber)
        mounted.focus()
        return true
      }
    }

    if (existingOpenFile && matchingNavTab) {
      activateCyclableTab(state, matchingNavTab)
      entry.fileId = existingOpenFile.id
      entry.tabId = matchingNavTab.tabId
      const mounted = mountedEditorsByFileId.get(existingOpenFile.id)
      if (mounted) {
        requestAnimationFrame(() => {
          mounted.setPosition({ lineNumber: entry.lineNumber, column: entry.column })
          mounted.revealLineInCenterIfOutsideViewport(entry.lineNumber)
          mounted.focus()
        })
      }
      scheduleEditorLineReveal(
        () => useAppStore.getState(),
        existingOpenFile.filePath,
        entry.lineNumber,
        entry.column,
        existingOpenFile.id
      )
      return true
    }

    // Re-open closed or replaced preview editor tab, matching VS Code's Go Back behavior.
    state.openFile(
      {
        filePath: entry.filePath,
        relativePath: entry.relativePath,
        worktreeId,
        language: detectLanguage(entry.filePath),
        mode: 'edit',
        runtimeEnvironmentId: entry.runtimeEnvironmentId ?? undefined
      },
      {
        preview: true,
        targetGroupId: state.activeGroupIdByWorktree?.[worktreeId],
        recordReplacedPreview: true
      }
    )
    const openedFileId = getOpenedEditFileIdAfterOpen(
      useAppStore.getState(),
      entry.filePath,
      worktreeId
    )
    if (openedFileId) {
      entry.fileId = openedFileId
    }
    scheduleEditorLineReveal(
      () => useAppStore.getState(),
      entry.filePath,
      entry.lineNumber,
      entry.column,
      openedFileId
    )
    return true
  }

  // Non-editor tab ('terminal' | 'browser' | 'simulator' | 'agent-session')
  const allTabIds = getActiveTabNavOrder(state, worktreeId)
  const match: TypeCyclableTab | undefined =
    (entry.tabId ? allTabIds.find((t) => t.tabId === entry.tabId) : undefined) ??
    allTabIds.find((t) => t.type === entry.tabType && t.id === entry.entityId)

  if (!match) {
    return false
  }
  activateCyclableTab(state, match)
  return true
}

export function navigateWorkspaceHistory(direction: 'back' | 'forward'): boolean {
  const state = useAppStore.getState()
  const worktreeId = state.activeWorktreeId
  if (!worktreeId) {
    return false
  }

  const stack = getOrCreateStack(worktreeId)
  if (stack.entries.length === 0) {
    const seed = resolveCurrentNavEntryFromStore(state)
    if (seed) {
      pushHistoryEntry(seed)
    }
    return false
  }

  syncCurrentEditorPositionBeforeStep(worktreeId)

  const step = direction === 'back' ? -1 : 1
  let candidateIndex = stack.index + step

  isRestoringHistory = true
  suppressWorkspaceHistoryRecording(260)
  try {
    while (candidateIndex >= 0 && candidateIndex < stack.entries.length) {
      const targetEntry = stack.entries[candidateIndex]
      if (applyHistoryEntry(targetEntry)) {
        stack.index = candidateIndex
        return true
      }
      // If a non-editor tab was closed and cannot be reopened, remove it and keep stepping.
      stack.entries.splice(candidateIndex, 1)
      if (step < 0) {
        stack.index = Math.max(0, stack.index - 1)
        candidateIndex = stack.index - 1
      }
    }
    return false
  } finally {
    isRestoringHistory = false
  }
}

export function installWorkspaceNavigationHistory(): () => void {
  const recordFromStoreState = (state: ReturnType<typeof useAppStore.getState>): void => {
    if (isRecordingSuppressed()) {
      return
    }
    const entry = resolveCurrentNavEntryFromStore(state)
    if (!entry) {
      return
    }
    const stack = getOrCreateStack(entry.worktreeId)
    const current = stack.index >= 0 ? stack.entries[stack.index] : undefined
    if (current && isSameTabTarget(current, entry)) {
      return
    }
    pushHistoryEntry(entry)
  }

  // Seed initial state if available
  recordFromStoreState(useAppStore.getState())

  const unsubscribeStore = useAppStore.subscribe((state) => {
    recordFromStoreState(state)
  })

  const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')

  const resolveHistoryDirectionFromKeyEvent = (
    event: KeyboardEvent
  ): 'back' | 'forward' | null => {
    if (event.defaultPrevented || event.isComposing || event.metaKey) {
      return null
    }
    if (isMac) {
      // VS Code macOS default: Ctrl + - (Back), Ctrl + Shift + - (Forward), or Ctrl + Option + Left/Right
      if (event.ctrlKey && !event.altKey && (event.code === 'Minus' || event.key === '-' || event.key === '_')) {
        return event.shiftKey ? 'forward' : 'back'
      }
      if (
        event.ctrlKey &&
        event.altKey &&
        !event.shiftKey &&
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
      ) {
        return event.key === 'ArrowLeft' ? 'back' : 'forward'
      }
      return null
    }
    // Windows / Linux default: Alt + Left (Back), Alt + Right (Forward)
    if (
      event.altKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    ) {
      return event.key === 'ArrowLeft' ? 'back' : 'forward'
    }
    return null
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    const direction = resolveHistoryDirectionFromKeyEvent(event)
    if (!direction) {
      return
    }

    if (
      event.target instanceof Element &&
      event.target.closest('[data-shortcut-recorder-active]') !== null
    ) {
      return
    }

    const context = getKeybindingContext(event.target)
    if (context === 'browser') {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()

    if (!event.repeat) {
      navigateWorkspaceHistory(direction)
    }
  }

  addAppKeyListener('keydown', onKeyDown)

  return () => {
    unsubscribeStore()
    removeAppKeyListener('keydown', onKeyDown)
  }
}
