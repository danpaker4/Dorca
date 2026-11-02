import type { editor } from 'monaco-editor'
import type { TabCycleType } from '@/components/terminal/tab-type-cycle'

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
export const mountedEditorsByFileId = new Map<string, editor.IStandaloneCodeEditor>()

let isRestoringHistory = false
let suppressRecordingUntil = 0

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase()
}

export function suppressWorkspaceHistoryRecording(durationMs = 220): void {
  const until = performance.now() + durationMs
  if (until > suppressRecordingUntil) {
    suppressRecordingUntil = until
  }
}

export function isRecordingSuppressed(): boolean {
  return isRestoringHistory || performance.now() < suppressRecordingUntil
}

export function getOrCreateStack(worktreeId: string): WorktreeHistoryStack {
  let stack = historyByWorktreeId.get(worktreeId)
  if (!stack) {
    stack = { entries: [], index: -1 }
    historyByWorktreeId.set(worktreeId, stack)
  }
  return stack
}

export function isSameTabTarget(a: NavHistoryEntry, b: NavHistoryEntry): boolean {
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

export function pushHistoryEntry(entry: NavHistoryEntry, forceDistinctLine = false): void {
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
    if (current?.kind === 'editor' && normalizePath(current.filePath) === normalizePath(filePath)) {
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
    if (current?.kind === 'editor' && normalizePath(current.filePath) === normalizePath(filePath)) {
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

export function syncCurrentEditorPositionBeforeStep(worktreeId: string): void {
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

export function setRestoringHistory(value: boolean): void {
  isRestoringHistory = value
}
