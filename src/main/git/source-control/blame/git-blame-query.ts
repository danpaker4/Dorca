import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { BoundedMap } from '../../../../shared/collections/bounded-map'
import {
  parseGitBlame,
  projectGitBlame,
  uncommittedBlame,
  type GitBlameRequest,
  type GitBlameResult,
  type GitBlameLine
} from '../../../../shared/git/blame/git-blame'
import {
  getGitInlineHunks,
  normalizeGitEditorText
} from '../../../../shared/git/diff/git-inline-hunks'
import { gitExecFileAsync } from '../../command-runner/git-exec-file'
import {
  gitReadOptionsForWorktree,
  type GitRuntimeOptions
} from '../../command-runner/git-runtime-options'

const MAX_BYTES = 1024 * 1024
const cache = new BoundedMap<string, { content: string; lines: GitBlameLine[] }>({
  maxEntries: 24,
  maxBytes: 16 * MAX_BYTES,
  sizeOf: (value) => value.content.length * 2 + JSON.stringify(value.lines).length * 2
})

export async function queryGitBlame(
  root: string,
  request: GitBlameRequest,
  options: GitRuntimeOptions = {}
): Promise<GitBlameResult> {
  let directory = posix.dirname(request.filePath)
  const exec = async (args: string[]): Promise<string> =>
    (
      await gitExecFileAsync(['-C', directory, '-c', 'core.quotepath=false', ...args], {
        ...gitReadOptionsForWorktree(root, options),
        maxBuffer: 16 * MAX_BYTES,
        timeout: 15000
      })
    ).stdout
  let prefix: string
  for (;;) {
    try {
      prefix = (await exec(['rev-parse', '--show-prefix'])).replace(/\r?\n$/, '')
      break
    } catch (error) {
      const missing =
        error instanceof Error &&
        'stderr' in error &&
        /cannot change to .*No such file or directory/i.test(String(error.stderr))
      if (!missing || directory === '.') {
        throw error
      }
      directory = posix.dirname(directory)
    }
  }
  const gitPath = prefix + posix.relative(directory, request.filePath)
  const workspacePrefix = request.filePath.endsWith(gitPath)
    ? request.filePath.slice(0, -gitPath.length)
    : ''
  directory = (await exec(['rev-parse', '--show-toplevel'])).replace(/\r?\n$/, '')
  const expose = (line: GitBlameLine): GitBlameLine => ({
    ...line,
    path: workspacePrefix + line.path,
    previousPath: line.previousPath ? workspacePrefix + line.previousPath : undefined
  })
  const readBlob = async (revision: string, path: string): Promise<string> => {
    const content = normalizeGitEditorText(await exec(['show', `${revision}:${path}`]))
    if (Buffer.byteLength(content) > MAX_BYTES || content.includes('\0')) {
      throw new Error('Blame supports text files up to 1 MiB.')
    }
    return content
  }
  const head =
    (
      await exec(['rev-parse', '--verify', '--quiet', 'HEAD']).catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 1) {
          return ''
        }
        throw error
      })
    ).trim() || null
  const buffer = normalizeGitEditorText(request.bufferContent ?? '')
  if (Buffer.byteLength(buffer) > MAX_BYTES || buffer.split('\n').length > 20000) {
    throw new Error('Blame supports files up to 1 MiB and 20,000 lines.')
  }
  let path = gitPath
  if (
    !request.revision &&
    head &&
    !(await exec(['ls-tree', '-z', head, '--', `:(literal)${path}`]))
  ) {
    const status = (await exec(['status', '--porcelain=v1', '-z', '--untracked-files=no'])).split(
      '\0'
    )
    for (let i = 0; i < status.length; i++) {
      if (status[i][0] === 'R' || status[i][1] === 'R') {
        if (status[i].slice(3) === path && status[i + 1]) {
          path = status[i + 1]
          break
        }
        i++
      }
    }
  }
  const revision = request.revision ?? head
  let content = ''
  let lines: GitBlameLine[] = []
  if (revision) {
    const key = createHash('sha256')
      .update(JSON.stringify([root, options.wslDistro, revision, path]))
      .digest('hex')
    const cached = cache.get(key)
    if (cached) {
      ;({ content, lines } = cached)
    } else {
      const exists = await exec(['ls-tree', '-z', revision, '--', `:(literal)${path}`])
      if (exists) {
        content = await readBlob(revision, path)
        if (content.split('\n').length > 20000) {
          throw new Error('This file is too large for blame.')
        }
        lines = parseGitBlame(await exec(['blame', '--line-porcelain', revision, '--', path]))
        cache.set(key, { content, lines })
      }
    }
  }
  const projected = request.revision ? lines : projectGitBlame(content, buffer, lines, gitPath)
  if (request.mode === 'snapshot') {
    return { snapshot: { head, lines: projected.map(expose) } }
  }
  const line = request.line ?? 1
  if (request.revision && !projected.some((entry) => entry.line === line)) {
    throw new Error('This line has no earlier revision.')
  }
  const attribution = projected.find((entry) => entry.line === line) ?? uncommittedBlame(line, path)
  let parent: string | null = head
  let message = 'Uncommitted changes'
  let committer = 'You'
  let committedAt: number | null = null
  let originalContent = content
  let modifiedContent = buffer
  let previousPath = path
  let targetLine = line
  if (attribution.commit) {
    const fields = (
      await exec(['show', '-s', '--format=%P%x00%B%x00%cn <%ce>%x00%ct', attribution.commit])
    ).split('\0')
    parent = attribution.previousCommit ?? (fields[0].trim().split(' ')[0] || null)
    message = fields[1].trim()
    committer = fields[2].trim()
    committedAt = Number(fields[3].trim()) * 1000
    previousPath = attribution.previousPath ?? attribution.path
    modifiedContent = await readBlob(attribution.commit, attribution.path)
    originalContent = parent
      ? await readBlob(parent, previousPath).catch(async (error: unknown) => {
          const exists = await exec(['ls-tree', '-z', parent!, '--', `:(literal)${previousPath}`])
          if (!exists) {
            return ''
          }
          throw error
        })
      : ''
    targetLine = attribution.originalLine
  }
  const hunks = getGitInlineHunks(originalContent, modifiedContent)
  const hunk = hunks.find(
    (entry) => targetLine >= entry.lineNumber && targetLine <= entry.endLineNumber
  )
  let previousLine: number | null = targetLine
  for (const entry of hunks) {
    if (targetLine < entry.lineNumber) {
      break
    }
    const oldStart = originalContent.slice(0, entry.originalStart).split('\n').length
    if (targetLine <= entry.endLineNumber) {
      const oldCount = entry.originalText
        ? entry.originalText.split('\n').length - Number(entry.originalText.endsWith('\n'))
        : 0
      const offset = targetLine - entry.lineNumber
      previousLine = offset < oldCount ? oldStart + offset : null
      break
    }
    if (previousLine !== null) {
      previousLine += entry.originalText.split('\n').length - entry.modifiedText.split('\n').length
    }
  }
  previousLine =
    previousLine !== null && originalContent
      ? Math.max(
          1,
          Math.min(
            previousLine,
            originalContent.split('\n').length - Number(originalContent.endsWith('\n'))
          )
        )
      : null
  return {
    detail: {
      attribution: expose(attribution),
      message,
      committer,
      committedAt,
      parent,
      previousPath: workspacePrefix + previousPath,
      previousLine,
      original: hunk ? blamePreviewLine(hunk.originalText, targetLine - hunk.lineNumber) : '',
      modified: hunk ? blamePreviewLine(hunk.modifiedText, targetLine - hunk.lineNumber) : '',
      originalContent,
      modifiedContent
    }
  }
}

function blamePreviewLine(text: string, offset: number): string {
  return text.match(/[^\n]*\n|[^\n]+$/g)?.[offset] ?? ''
}
