import { useAppStore } from '@/store'
import { getKeybindingContext } from '@/components/terminal-workspace-model'
import { addAppKeyListener, removeAppKeyListener } from './app-keyboard-router'
import {
  applyHistoryEntry,
  resolveCurrentNavEntryFromStore
} from './workspace-navigation-history-targets'
import {
  getOrCreateStack,
  isRecordingSuppressed,
  isSameTabTarget,
  pushHistoryEntry,
  setRestoringHistory,
  suppressWorkspaceHistoryRecording,
  syncCurrentEditorPositionBeforeStep
} from './workspace-navigation-history-state'
export {
  registerEditorForNavigationHistory,
  recordExplicitEditorJump,
  suppressWorkspaceHistoryRecording
} from './workspace-navigation-history-state'
export type { NavHistoryEntry } from './workspace-navigation-history-state'

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

  setRestoringHistory(true)
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
    setRestoringHistory(false)
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

  const resolveHistoryDirectionFromKeyEvent = (event: KeyboardEvent): 'back' | 'forward' | null => {
    if (event.defaultPrevented || event.isComposing || event.metaKey) {
      return null
    }
    if (isMac) {
      // VS Code macOS default: Ctrl + - (Back), Ctrl + Shift + - (Forward), or Ctrl + Option + Left/Right
      if (
        event.ctrlKey &&
        !event.altKey &&
        (event.code === 'Minus' || event.key === '-' || event.key === '_')
      ) {
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
