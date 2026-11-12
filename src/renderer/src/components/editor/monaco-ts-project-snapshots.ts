import { PATH_EXISTENCE_BATCH_MAX } from '../../../../shared/file-access/path-existence-batch'
import { runtimePathsExist } from '@/runtime/files/metadata/runtime-path-existence-batch'
import { readRuntimeFileContent } from '@/runtime/files/reads/runtime-file-read-client'
import type { RuntimeFileOperationArgs } from '@/runtime/files/runtime-file-client-types'
import { computeRelativePath } from './monaco-ts-workspace-imports'

const MAX_SOURCE_FILES = 100_000
const MAX_RESOLUTION_PATHS = 1_000_000

export async function loadProjectSnapshots({
  context,
  files,
  paths,
  existencePaths,
  knownNames,
  maxSourceBytes,
  isCurrent,
  onSnapshot,
  onExistingPath
}: {
  context: RuntimeFileOperationArgs
  files: Record<string, string | null>
  paths: string[]
  existencePaths: string[]
  knownNames: Set<string>
  maxSourceBytes: number
  isCurrent(): boolean
  onSnapshot(path: string, content: string | null): void
  onExistingPath(path: string): void
}): Promise<boolean> {
  if (
    Object.keys(files).length + knownNames.size + paths.length + existencePaths.length >
    MAX_RESOLUTION_PATHS
  ) {
    return false
  }
  let sourceFiles = 0
  let bytes = 0
  for (const content of Object.values(files)) {
    if (content !== null) {
      sourceFiles++
      bytes += content.length * 2
    }
  }
  const record = (path: string, content: string | null): void => {
    files[path] = content
    onSnapshot(path, content)
    if (content !== null) {
      sourceFiles++
      bytes += content.length * 2
    }
  }
  const unverified: string[] = []
  const unknown = existencePaths.filter((path) => !knownNames.has(path) && !(path in files))
  for (let start = 0; start < unknown.length; start += PATH_EXISTENCE_BATCH_MAX) {
    if (!isCurrent()) {
      return false
    }
    const batch = unknown.slice(start, start + PATH_EXISTENCE_BATCH_MAX)
    const existence = await runtimePathsExist(
      context,
      batch,
      context.expectedEnvironmentPairingRevision,
      {
        codedAbsenceOnly: true
      }
    ).catch(() => [])
    if (!isCurrent()) {
      return false
    }
    batch.forEach((path, index) => {
      const row = existence[index]
      if (row && 'exists' in row) {
        if (row.exists) {
          onExistingPath(path)
        } else {
          record(path, null)
        }
      } else {
        unverified.push(path)
      }
    })
  }
  const unread = [...new Set([...paths, ...unverified])].filter((path) => !(path in files))
  for (let start = 0; start < unread.length; start += 16) {
    if (!isCurrent() || sourceFiles > MAX_SOURCE_FILES || bytes > maxSourceBytes) {
      return false
    }
    await Promise.all(
      unread.slice(start, start + 16).map(async (filePath) => {
        let content: string | null
        try {
          const result = await readRuntimeFileContent({
            ...context,
            worktreeId: context.worktreeId ?? undefined,
            filePath,
            relativePath: computeRelativePath(context.worktreePath ?? '', filePath)
          })
          content = !result.isBinary && typeof result.content === 'string' ? result.content : null
        } catch {
          content = null
        }
        if (isCurrent()) {
          record(filePath, content)
        }
      })
    )
  }
  return isCurrent() && sourceFiles <= MAX_SOURCE_FILES && bytes <= maxSourceBytes
}
