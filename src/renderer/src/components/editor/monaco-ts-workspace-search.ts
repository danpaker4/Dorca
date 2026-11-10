import type { SearchFileResult } from '../../../../shared/file-search/code-search-types'
import type { ModelWorkspaceContext } from './monaco-ts-workspace-models'

const searchCache = new Map<string, { timestamp: number; files: SearchFileResult[] }>()

const inFlightSearches = new Map<string, Promise<SearchFileResult[]>>()

const TS_JS_SEARCH_INCLUDE = '*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}'

const SEARCH_CACHE_TTL_MS = 5_000

export async function searchWorkspaceForWord(
  ctx: ModelWorkspaceContext,
  word: string
): Promise<SearchFileResult[]> {
  const key = `${ctx.worktreePath}::${word}`
  const now = Date.now()
  const cached = searchCache.get(key)
  if (cached && now - cached.timestamp < SEARCH_CACHE_TTL_MS) {
    return cached.files
  }

  const existingInFlight = inFlightSearches.get(key)
  if (existingInFlight) {
    return existingInFlight
  }

  const promise = (async (): Promise<SearchFileResult[]> => {
    try {
      const searchRes = await window.api.fs.search({
        query: word,
        rootPath: ctx.worktreePath,
        caseSensitive: true,
        wholeWord: true,
        includePattern: TS_JS_SEARCH_INCLUDE,
        maxResults: 200,
        connectionId: ctx.connectionId
      })
      const files = searchRes.files ?? []
      searchCache.set(key, { timestamp: Date.now(), files })
      return files
    } catch {
      return []
    } finally {
      inFlightSearches.delete(key)
    }
  })()

  inFlightSearches.set(key, promise)
  return promise
}
