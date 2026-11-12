import { createHash, randomUUID } from 'node:crypto'
import { copyFile, lstat, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  getGitInlineHunks,
  normalizeGitEditorText,
  type GitInlineHunkAction,
  type GitInlineSnapshot
} from '../../../shared/git/diff/git-inline-hunks'
import {
  resolveGitMetadataPath,
  resolveWorktreeHostPath
} from '../../../shared/git/metadata/git-metadata-path'
import { parseWslUncPath, toLinuxPath } from '../../../shared/wsl-paths'
import { isBinaryBuffer } from '../../../shared/file-preview/binary-buffer'
import { gitOptionsForWorktree, type GitRuntimeOptions } from '../git-runtime-options'
import { gitExecFileAsync, gitOptionalLocksDisabledEnv } from '../runner'
import { checkIgnoredPaths } from './check-ignored-paths'
import { literalPathspec } from './git-pathspec'
import { invalidateGitReadCaches } from './git-read-cache-invalidation'
async function inlineIndexPath(worktreePath: string, options: GitRuntimeOptions): Promise<string> {
  const { stdout } = await gitExecFileAsync(
    ['rev-parse', '--git-path', 'index'],
    gitOptionsForWorktree(worktreePath, options)
  )
  const hostPath = resolveWorktreeHostPath(worktreePath, options)
  const indexPath = hostPath && resolveGitMetadataPath(hostPath, stdout, options)
  if (!indexPath) {
    throw new Error('Cannot resolve this repository index on its owning host.')
  }
  return indexPath
}

const MAX_INLINE_BYTES = 1024 * 1024
const stale = (): Error => new Error('This change is stale. Refresh the inline diff and try again.')

async function readIndex(indexPath: string): Promise<Buffer | null> {
  try {
    return await readFile(indexPath)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

async function loadInlineSnapshot(
  worktreePath: string,
  filePath: string,
  options: GitRuntimeOptions
): Promise<
  GitInlineSnapshot & {
    mode: string
    indexExists: boolean
    diskExists: boolean
    headExists: boolean
    headRaw: string
    indexRaw: string
    diskRaw: string
  }
> {
  const gitOptions = {
    ...gitOptionsForWorktree(worktreePath, options),
    env: gitOptionalLocksDisabledEnv()
  }
  const exec = async (args: string[]): Promise<string> =>
    (await gitExecFileAsync(args, { ...gitOptions, maxBuffer: MAX_INLINE_BYTES })).stdout
  const indexPath = await inlineIndexPath(worktreePath, options)
  const before = await readIndex(indexPath)
  const pathspec = literalPathspec(filePath, worktreePath, options)
  const entries = (await exec(['ls-files', '--stage', '-z', '--', pathspec]))
    .split('\0')
    .filter(Boolean)
  if (entries.length > 1 || (entries[0] && !/^100(?:644|755) [a-f0-9]+ 0\t/.test(entries[0]))) {
    throw new Error('Inline Git actions require a regular file without merge conflicts.')
  }
  if (!entries.length && (await checkIgnoredPaths(worktreePath, [filePath], options)).length) {
    throw new Error('This file is ignored by Git.')
  }
  const attrs = await exec(['check-attr', '-z', 'filter', 'working-tree-encoding', '--', filePath])
  const values = attrs
    .split('\0')
    .filter(Boolean)
    .filter((_, index) => index % 3 === 2)
  if (values.some((value) => value !== 'unspecified' && value !== 'unset')) {
    throw new Error('Inline Git actions are unavailable for files with content conversion filters.')
  }
  const head = (
    await exec(['rev-parse', '--verify', '--quiet', 'HEAD']).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 1) {
        return ''
      }
      throw error
    })
  ).trim()
  const treeEntry = head ? await exec(['ls-tree', '-z', head, '--', pathspec]) : ''
  const headOid = treeEntry.match(/^100(?:644|755) blob ([a-f0-9]+)\t/)?.[1]
  if (treeEntry && !headOid) {
    throw new Error('Inline Git review requires a regular file.')
  }
  const indexOid = entries[0]?.split(' ')[1]
  const [headContent, indexContent] = await Promise.all([
    headOid ? exec(['cat-file', 'blob', headOid]) : '',
    indexOid ? exec(['cat-file', 'blob', indexOid]) : ''
  ])
  const hostPath = resolveWorktreeHostPath(worktreePath, options)
  if (!hostPath) {
    throw new Error('Cannot resolve this file on its owning host.')
  }
  let disk = Buffer.alloc(0)
  let diskExists = false
  let diskExecutable = false
  try {
    const file = join(hostPath, filePath)
    const stat = await lstat(file)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('Inline Git review requires a regular file.')
    }
    if (stat.size > MAX_INLINE_BYTES) {
      throw new Error('This file is too large for inline Git review.')
    }
    diskExecutable = (stat.mode & 0o111) !== 0
    disk = await readFile(file)
    diskExists = true
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error
    }
  }
  const diskText = disk.toString('utf8')
  for (const value of [headContent, indexContent, diskText]) {
    const bytes = Buffer.from(value)
    if (isBinaryBuffer(bytes) || bytes.length > MAX_INLINE_BYTES || value.includes('\ufffd')) {
      throw new Error('Inline Git review requires a UTF-8 text file.')
    }
  }
  const after = await readIndex(indexPath)
  if (before === null ? after !== null : after === null || !before.equals(after)) {
    throw stale()
  }
  let mode = entries[0]?.split(' ')[0] ?? treeEntry.split(' ')[0]
  if (!mode && diskExecutable) {
    const fileMode = await exec(['config', '--bool', 'core.filemode']).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 1) {
        return ''
      }
      throw error
    })
    mode = fileMode.trim() === 'false' ? '100644' : '100755'
  }
  const token = createHash('sha256')
    .update(
      JSON.stringify([
        before ? createHash('sha256').update(before).digest('hex') : null,
        head,
        filePath,
        headContent,
        indexContent,
        diskExists,
        diskExecutable,
        mode || '100644',
        disk.toString('base64'),
        attrs
      ])
    )
    .digest('hex')
  return {
    token,
    headRaw: headContent,
    indexRaw: indexContent,
    diskRaw: diskText,
    headContent: normalizeGitEditorText(headContent),
    indexContent: normalizeGitEditorText(indexContent),
    diskContent: normalizeGitEditorText(diskText),
    mode: mode || '100644',
    headExists: !!headOid,
    indexExists: !!indexOid,
    diskExists
  }
}

export async function getGitInlineSnapshot(
  worktreePath: string,
  filePath: string,
  options: GitRuntimeOptions = {}
): Promise<GitInlineSnapshot> {
  const { token, headContent, indexContent, diskContent, headExists, indexExists, diskExists } =
    await loadInlineSnapshot(worktreePath, filePath, options)
  return { token, headContent, indexContent, diskContent, headExists, indexExists, diskExists }
}

export async function applyGitInlineHunk(
  worktreePath: string,
  action: GitInlineHunkAction,
  options: GitRuntimeOptions = {}
): Promise<void> {
  if (!Number.isSafeInteger(action.hunkIndex) || action.hunkIndex < 0) {
    throw stale()
  }
  const indexPath = await inlineIndexPath(worktreePath, options)
  const gitDir = dirname(indexPath)
  const lockPath = `${indexPath}.lock`
  // Holding Git's own lock fences external agents and terminals, including other Dorca clients.
  const lock = await open(lockPath, 'wx')
  const temporaryIndex = join(gitDir, `dorca-hunk-${randomUUID()}`)
  let committed = false
  try {
    const snapshot = await loadInlineSnapshot(worktreePath, action.filePath, options)
    if (snapshot.token !== action.token) {
      throw stale()
    }
    if (normalizeGitEditorText(action.bufferContent) !== snapshot.diskContent) {
      throw new Error('Save this file before staging or unstaging a change.')
    }
    const original = action.staged ? snapshot.headContent : snapshot.indexContent
    const modified = action.staged ? snapshot.indexContent : snapshot.diskContent
    const hunk = getGitInlineHunks(original, modified, {
      originalExists: action.staged ? snapshot.headExists : snapshot.indexExists,
      modifiedExists: action.staged ? snapshot.indexExists : snapshot.diskExists
    })[action.hunkIndex]
    if (!hunk) {
      throw stale()
    }
    const rawOffset = (text: string, offset: number): number => {
      let raw = 0
      for (let normalized = 0; normalized < offset; normalized++, raw++) {
        if (text[raw] === '\r' && text[raw + 1] === '\n') {
          raw++
        }
      }
      return raw
    }
    const base = snapshot.indexRaw
    let replacementSource = snapshot.headRaw
    if (!action.staged) {
      const { stdout } = await gitExecFileAsync(
        ['hash-object', '-w', `--path=${action.filePath}`, '--stdin'],
        {
          ...gitOptionsForWorktree(worktreePath, options),
          stdin: snapshot.diskRaw
        }
      )
      replacementSource = (
        await gitExecFileAsync(
          ['cat-file', 'blob', stdout.trim()],
          gitOptionsForWorktree(worktreePath, options)
        )
      ).stdout
    }
    const start = action.staged ? hunk.modifiedStart : hunk.originalStart
    const end = action.staged ? hunk.modifiedEnd : hunk.originalEnd
    const replacementStart = action.staged ? hunk.originalStart : hunk.modifiedStart
    const replacementEnd = action.staged ? hunk.originalEnd : hunk.modifiedEnd
    const next =
      base.slice(0, rawOffset(base, start)) +
      replacementSource.slice(
        rawOffset(replacementSource, replacementStart),
        rawOffset(replacementSource, replacementEnd)
      ) +
      base.slice(rawOffset(base, end))
    const gitOptions = {
      ...gitOptionsForWorktree(worktreePath, options),
      env: {
        ...gitOptionalLocksDisabledEnv(),
        GIT_INDEX_FILE:
          options.wslDistro || parseWslUncPath(temporaryIndex)
            ? toLinuxPath(temporaryIndex)
            : temporaryIndex
      }
    }
    await ((await readIndex(indexPath))
      ? copyFile(indexPath, temporaryIndex)
      : gitExecFileAsync(['read-tree', '--empty'], gitOptions))
    const { stdout: prefix } = await gitExecFileAsync(
      ['rev-parse', '--show-prefix'],
      gitOptionsForWorktree(worktreePath, options)
    )
    const repositoryPath = prefix.trimEnd() + action.filePath
    const remove = next === '' && (action.staged ? !snapshot.headExists : !snapshot.diskExists)
    if (remove) {
      await gitExecFileAsync(['update-index', '--force-remove', '--', action.filePath], gitOptions)
    } else {
      const { stdout } = await gitExecFileAsync(['hash-object', '-w', '--stdin'], {
        ...gitOptions,
        stdin: next
      })
      await gitExecFileAsync(
        ['update-index', '--add', '--cacheinfo', snapshot.mode, stdout.trim(), repositoryPath],
        gitOptions
      )
    }
    if ((await loadInlineSnapshot(worktreePath, action.filePath, options)).token !== action.token) {
      throw stale()
    }
    await lock.writeFile(await readFile(temporaryIndex))
    await lock.sync()
    await lock.close()
    await rename(lockPath, indexPath)
    committed = true
  } finally {
    await lock.close().catch(() => {})
    if (!committed) {
      await unlink(lockPath)
    }
    await unlink(temporaryIndex).catch(() => {})
    invalidateGitReadCaches()
  }
}
