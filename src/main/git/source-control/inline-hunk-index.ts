import { readFile } from 'node:fs/promises'
import {
  resolveGitMetadataPath,
  resolveWorktreeHostPath
} from '../../../shared/git/metadata/git-metadata-path'
import { gitOptionsForWorktree, type GitRuntimeOptions } from '../git-runtime-options'
import { gitExecFileAsync } from '../command-runner/git-exec-file'

export async function inlineIndexPath(
  worktreePath: string,
  options: GitRuntimeOptions
): Promise<string> {
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

export async function readIndex(indexPath: string): Promise<Buffer | null> {
  try {
    return await readFile(indexPath)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}
