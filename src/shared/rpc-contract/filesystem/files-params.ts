import { PATH_EXISTENCE_BATCH_MAX } from '../../file-access/path-existence-batch'
import { FILE_READ_DIR_MAX_PAGE_ENTRIES } from '../../file-listing/file-dir-page'
import { z } from 'zod'
import { lazyZodSchema } from '../../schema/lazy-zod-schema'
import { QUICK_OPEN_REMOTE_QUERY_MAX_CODE_UNITS } from '../../quick-open/quick-open-path-search'
import { RUNTIME_NAVIGATION_TARGETS } from '../../remote-runtime/session-graph/runtime-navigation'
import { TYPESCRIPT_NAVIGATION_KINDS } from '../../editor-language/typescript-navigation'
import { FileOpen, WorktreeSelector } from './files-target-params'

export const TypeScriptNavigationPayload = lazyZodSchema(() =>
  z
    .object({
      rootPath: z.string().min(1).max(32_768),
      filePath: z.string().min(1).max(32_768),
      kind: z.enum(TYPESCRIPT_NAVIGATION_KINDS),
      lineNumber: z.number().int().min(1),
      column: z.number().int().min(1),
      includeDeclaration: z.boolean(),
      buffers: z
        .array(
          z.object({
            filePath: z.string().min(1).max(32_768),
            content: z.string().max(16 * 1024 * 1024),
            languageId: z.string().max(64)
          })
        )
        .max(512)
    })
    .refine(
      (request) =>
        request.buffers.reduce((sum, buffer) => sum + buffer.content.length * 2, 0) <=
        32 * 1024 * 1024,
      { message: 'TypeScript navigation buffers exceed their transfer budget' }
    )
)

export const FileTypeScriptNavigation = lazyZodSchema(() =>
  TypeScriptNavigationPayload.safeExtend(WorktreeSelector.shape)
)

export const FilePathsExist = lazyZodSchema(() =>
  WorktreeSelector.extend({
    relativePaths: z.array(z.string()).max(PATH_EXISTENCE_BATCH_MAX)
  })
)

export const FilePathSearch = lazyZodSchema(() =>
  WorktreeSelector.extend({
    allowLegacyIncludeIgnored: z.boolean().optional(),
    includeIgnored: z.boolean().optional(),
    followSymlinks: z.boolean().optional(),
    query: z.string().max(QUICK_OPEN_REMOTE_QUERY_MAX_CODE_UNITS).default(''),
    limit: z.number().int().positive().max(32).default(16),
    excludePaths: z.array(z.string()).optional(),
    mode: z.literal('quick-open').optional()
  })
)

export const ChatImageRead = lazyZodSchema(() =>
  WorktreeSelector.extend({ path: z.string().min(1).max(4096) })
)

export const ResolveTerminalPath = lazyZodSchema(() =>
  WorktreeSelector.extend({
    pathText: z
      .unknown()
      .transform((v) => (typeof v === 'string' ? v : ''))
      .pipe(z.string().min(1, 'Missing path text')),
    terminal: z
      .unknown()
      .transform((v) => (typeof v === 'string' && v.length > 0 ? v : null))
      .nullable()
      .optional(),
    cwd: z
      .unknown()
      .transform((v) => (typeof v === 'string' && v.length > 0 ? v : null))
      .nullable()
      .optional(),
    crossWorkspace: z
      .unknown()
      .transform((v) => v === true)
      .optional(),
    nativeChatContext: z
      .object({
        tabId: z.string().min(1),
        sessionId: z.string().min(1)
      })
      .optional()
  })
)

// Why: only 'host'/'all' move the desktop; absent `navigation` (phones, older CLIs) opens like 'caller' (#33052).
const FileOpenTarget = lazyZodSchema(() =>
  FileOpen.extend({
    navigation: z.enum(RUNTIME_NAVIGATION_TARGETS).optional()
  })
)

export const FileOpenTab = lazyZodSchema(() =>
  FileOpenTarget.extend({
    line: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    column: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional()
  }).refine((params) => params.column === undefined || params.line !== undefined, {
    message: 'column requires line',
    path: ['column']
  })
)

export const FileOpenDiff = lazyZodSchema(() =>
  FileOpenTarget.extend({
    staged: z.boolean().optional(),
    oldPath: z.string().optional()
  })
)

export const DocPreviewFileRead = lazyZodSchema(() =>
  FileOpen.extend({
    entryRelativePath: z.string().min(1),
    implicitRootRelativePath: z.string().nullable(),
    authorizedRootRelativePaths: z.array(z.string())
  })
)

export const FileTreePath = lazyZodSchema(() =>
  WorktreeSelector.extend({
    followSymlinks: z.boolean().optional(),
    relativePath: z
      .unknown()
      .transform((v) => (typeof v === 'string' ? v : ''))
      .pipe(z.string())
  })
)

/** With `after` or `limit` the reply is a `DirEntryPage`; without both it stays the bare entry array. */
export const FileDirRead = lazyZodSchema(() =>
  FileTreePath.extend({
    after: z.object({ name: z.string().min(1).max(4096), isDirectory: z.boolean() }).optional(),
    limit: z.number().int().positive().max(FILE_READ_DIR_MAX_PAGE_ENTRIES).optional()
  })
)

export const ServerDirectoryBrowse = lazyZodSchema(() =>
  z.object({
    path: z
      .unknown()
      .transform((v) => (typeof v === 'string' ? v : ''))
      .pipe(z.string())
  })
)

export const FileChunkRange = {
  offset: z.number().int().nonnegative(),
  length: z
    .number()
    .int()
    .positive()
    .max(512 * 1024)
}

export const FileReadChunk = lazyZodSchema(() => FileOpen.extend(FileChunkRange))

export const DocPreviewFileReadChunk = lazyZodSchema(() =>
  DocPreviewFileRead.extend(FileChunkRange).extend({
    /** Streams audio/video past the whole-read caps; older hosts drop it and keep refusing media. */
    media: z.boolean().optional()
  })
)

export const FileSearch = lazyZodSchema(() =>
  WorktreeSelector.extend({
    query: z
      .unknown()
      .transform((v) => (typeof v === 'string' ? v : ''))
      .pipe(z.string().min(1, 'Missing search query')),
    caseSensitive: z.boolean().optional(),
    wholeWord: z.boolean().optional(),
    useRegex: z.boolean().optional(),
    includePattern: z.string().optional(),
    excludePattern: z.string().optional(),
    maxResults: z.number().int().positive().optional()
  })
)

// Optional maxResults aligns remote callers with desktop caps; older hosts strip it and retain their defaults.
export const FileListAll = lazyZodSchema(() =>
  WorktreeSelector.extend({
    candidatePaths: z
      .array(z.string().max(64 * 1024))
      .max(100)
      .optional(),
    includeIgnored: z.boolean().optional(),
    followSymlinks: z.boolean().optional(),
    excludePaths: z.array(z.string()).optional(),
    maxResults: z.number().int().positive().optional()
  })
)

export const FileUnwatch = lazyZodSchema(() =>
  z.object({
    subscriptionId: z
      .unknown()
      .transform((value) => (typeof value === 'string' && value.length > 0 ? value : ''))
      .pipe(z.string().min(1, 'Missing subscriptionId'))
  })
)
