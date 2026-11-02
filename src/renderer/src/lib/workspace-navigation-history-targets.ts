import { useAppStore } from '@/store'
import { getActiveTabNavOrder } from '@/components/tab-bar/group-tab-order'
import {
  getActiveEntityIdForTabType,
  type TypeCyclableTab
} from '@/components/terminal/tab-type-cycle'
import { activateCyclableTab } from '@/hooks/ipc-tab-switch'
import { detectLanguage } from './language-detect'
import { getOpenedEditFileIdAfterOpen } from '@/store/slices/editor/file-ids/editor-file-ids'
import { scheduleEditorLineReveal } from '@/store/slices/editor/focus/editor-focus-reveal'
import {
  mountedEditorsByFileId,
  normalizePath,
  type NavHistoryEntry
} from './workspace-navigation-history-state'

export function resolveCurrentNavEntryFromStore(
  state: ReturnType<typeof useAppStore.getState>
): NavHistoryEntry | null {
  const worktreeId = state.activeWorktreeId
  if (!worktreeId) {
    return null
  }
  const allTabIds = getActiveTabNavOrder(state, worktreeId)
  const activeGroupId = state.activeGroupIdByWorktree?.[worktreeId]
  const group = activeGroupId
    ? (state.groupsByWorktree?.[worktreeId] ?? []).find(
        (candidate) => candidate.id === activeGroupId
      )
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
    const lineNumber = pos?.lineNumber ?? state.editorCursorLine[openFile.id] ?? 1
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

export function applyHistoryEntry(entry: NavHistoryEntry): boolean {
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
