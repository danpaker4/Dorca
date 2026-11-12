import { diffLines } from 'diff'

export type GitInlineHunk = {
  kind: 'added' | 'deleted' | 'modified'
  originalStart: number
  originalEnd: number
  modifiedStart: number
  modifiedEnd: number
  originalText: string
  modifiedText: string
  lineNumber: number
  endLineNumber: number
}

export type GitInlineSnapshot = {
  token: string
  headContent: string
  indexContent: string
  diskContent: string
  headExists: boolean
  indexExists: boolean
  diskExists: boolean
}

export type GitInlineHunkAction = {
  filePath: string
  token: string
  staged: boolean
  hunkIndex: number
  bufferContent: string
}

export const normalizeGitEditorText = (text: string): string => text.replace(/\r\n/g, '\n')

export function getGitInlineHunks(
  original: string,
  modified: string,
  presence?: { originalExists: boolean; modifiedExists: boolean }
): GitInlineHunk[] {
  const changes = diffLines(original, modified, { timeout: 100, maxEditLength: 10000 })
  if (!changes) {
    throw new Error('This change is too large for inline Git review. Open the full diff instead.')
  }
  const hunks: GitInlineHunk[] = []
  let originalOffset = 0
  let modifiedOffset = 0
  let line = 1
  let hunk: GitInlineHunk | undefined
  for (const change of changes) {
    if (!change.added && !change.removed) {
      hunk = undefined
      originalOffset += change.value.length
      modifiedOffset += change.value.length
      line += change.value.split('\n').length - 1
      continue
    }
    if (!hunk) {
      hunk = {
        kind: change.removed ? 'deleted' : 'added',
        originalStart: originalOffset,
        originalEnd: originalOffset,
        modifiedStart: modifiedOffset,
        modifiedEnd: modifiedOffset,
        originalText: '',
        modifiedText: '',
        lineNumber: line,
        endLineNumber: line
      }
      hunks.push(hunk)
    }
    if (change.removed) {
      originalOffset += change.value.length
      hunk.originalEnd = originalOffset
      hunk.originalText += change.value
    } else {
      modifiedOffset += change.value.length
      hunk.modifiedEnd = modifiedOffset
      hunk.modifiedText += change.value
      line += change.value.split('\n').length - 1
      hunk.endLineNumber = Math.max(hunk.lineNumber, line - (change.value.endsWith('\n') ? 1 : 0))
    }
  }
  for (const entry of hunks) {
    entry.kind = !entry.originalText ? 'added' : !entry.modifiedText ? 'deleted' : 'modified'
  }
  if (!hunks.length && presence && presence.originalExists !== presence.modifiedExists) {
    return [
      {
        kind: presence.originalExists ? 'deleted' : 'added',
        originalStart: 0,
        originalEnd: 0,
        modifiedStart: 0,
        modifiedEnd: 0,
        originalText: '',
        modifiedText: '',
        lineNumber: 1,
        endLineNumber: 1
      }
    ]
  }
  return hunks
}
