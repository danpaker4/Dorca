import { relativePathInsideRoot } from '../../../../shared/cross-platform-path'

export function computeRelativePath(worktreePath: string, filePath: string): string {
  return relativePathInsideRoot(worktreePath, filePath) ?? filePath
}
