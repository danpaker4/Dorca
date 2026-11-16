import { diffLines } from 'diff'
import { decodeGitCQuotedPath } from '../paths/git-cquoted-path'

export type GitBlameLine = {
  line: number
  originalLine: number
  commit: string | null
  author: string
  email: string
  timestamp: number | null
  summary: string
  path: string
  previousCommit?: string
  previousPath?: string
}

export type GitBlameSnapshot = {
  head: string | null
  lines: GitBlameLine[]
}

export type GitBlameDetail = {
  attribution: GitBlameLine
  message: string
  committer: string
  committedAt: number | null
  parent: string | null
  original: string
  modified: string
  previousLine: number | null
  previousPath: string
  originalContent: string
  modifiedContent: string
}

export type GitBlameRequest = {
  channel: string
  sequence: number
  mode: 'snapshot' | 'detail' | 'cancel'
  filePath: string
  bufferContent?: string
  revision?: string
  line?: number
}

export type GitBlameResult = {
  snapshot?: GitBlameSnapshot
  detail?: GitBlameDetail
}

export function parseGitBlame(text: string): GitBlameLine[] {
  const lines: GitBlameLine[] = []
  let current: GitBlameLine | undefined
  for (const row of text.split('\n')) {
    const header = /^([a-f0-9]{40,64}) (\d+) (\d+)(?: \d+)?$/.exec(row)
    if (header) {
      current = {
        commit: /^0+$/.test(header[1]) ? null : header[1],
        originalLine: Number(header[2]),
        line: Number(header[3]),
        author: '',
        email: '',
        timestamp: null,
        summary: '',
        path: ''
      }
    } else if (current) {
      if (row.startsWith('\t')) {
        lines.push(current)
        current = undefined
      } else if (row.startsWith('author ')) {
        current.author = row.slice(7)
      } else if (row.startsWith('author-mail ')) {
        current.email = row.slice(12).replace(/^<|>$/g, '')
      } else if (row.startsWith('author-time ')) {
        current.timestamp = Number(row.slice(12)) * 1000
      } else if (row.startsWith('summary ')) {
        current.summary = row.slice(8)
      } else if (row.startsWith('filename ')) {
        current.path = decodeGitCQuotedPath(row.slice(9))
      } else if (row.startsWith('previous ')) {
        const space = row.indexOf(' ', 9)
        current.previousCommit = row.slice(9, space)
        current.previousPath = decodeGitCQuotedPath(row.slice(space + 1))
      }
    }
  }
  return lines
}

export function uncommittedBlame(line: number, path: string): GitBlameLine {
  return {
    line,
    originalLine: line,
    path,
    commit: null,
    author: 'You',
    email: '',
    timestamp: null,
    summary: 'Uncommitted changes'
  }
}

// Only equal spans inherit history; replacements and insertions always belong to the working tree.
export function projectGitBlame(
  original: string,
  buffer: string,
  lines: GitBlameLine[],
  path: string
): GitBlameLine[] {
  const changes = diffLines(original, buffer, { timeout: 100, maxEditLength: 10000 })
  if (!changes) {
    throw new Error('This change is too large for inline blame.')
  }
  let before = 0
  let after = 0
  const result: GitBlameLine[] = []
  for (const change of changes) {
    const count = change.count ?? 0
    if (change.removed) {
      before += count
      continue
    }
    for (let i = 0; i < count; i++) {
      const old = !change.added ? lines[before + i] : undefined
      result.push(old ? { ...old, line: after + i + 1 } : uncommittedBlame(after + i + 1, path))
    }
    after += count
    if (!change.added) {
      before += count
    }
  }
  if (buffer.endsWith('\n') || !buffer) {
    result.push(uncommittedBlame(after + 1, path))
  }
  return result
}
