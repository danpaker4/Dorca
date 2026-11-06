import type { ModelWorkspaceContext } from './monaco-ts-workspace-models'

const resolvedImportPathCache = new Map<string, { timestamp: number; filePath: string | null }>()

const IMPORT_PATH_CACHE_TTL_MS = 15_000

const RESOLVABLE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.d.ts',
  '.js',
  '.jsx',
  '.mts',
  '.cts',
  '.mjs',
  '.cjs',
  '.json'
]

export function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/')
}

export function computeRelativePath(worktreePath: string, filePath: string): string {
  const normRoot = normalizeSlashes(worktreePath).replace(/\/+$/, '')
  const normFile = normalizeSlashes(filePath)
  if (normFile.toLowerCase().startsWith(`${normRoot.toLowerCase()}/`)) {
    return normFile.slice(normRoot.length + 1)
  }
  return filePath
}

function dirnameOf(filePath: string): string {
  const useBackslash = filePath.includes('\\')
  const norm = normalizeSlashes(filePath).replace(/\/+$/, '')
  const idx = norm.lastIndexOf('/')
  if (idx === -1) {
    return filePath
  }
  const dir = norm.slice(0, idx)
  return useBackslash ? dir.replace(/\//g, '\\') : dir
}

function joinAndNormalizePath(baseDir: string, relativeSpecifier: string): string {
  const useBackslash = baseDir.includes('\\')
  const normBase = normalizeSlashes(baseDir).replace(/\/+$/, '')
  let prefix = ''
  let restBase = normBase
  if (restBase.startsWith('//')) {
    prefix = '//'
    restBase = restBase.slice(2)
  } else if (restBase.startsWith('/')) {
    prefix = '/'
    restBase = restBase.slice(1)
  } else if (/^[A-Za-z]:/.test(restBase)) {
    prefix = `${restBase.slice(0, 2)}/`
    restBase = restBase.slice(2).replace(/^\/+/, '')
  }

  const combined = `${restBase}/${normalizeSlashes(relativeSpecifier)}`.split('/')
  const stack: string[] = []
  for (const segment of combined) {
    if (!segment || segment === '.') {
      continue
    }
    if (segment === '..') {
      stack.pop()
      continue
    }
    stack.push(segment)
  }
  const result = prefix + stack.join('/')
  return useBackslash ? result.replace(/\//g, '\\') : result
}

function findNearestSrcAncestor(filePath: string): string | null {
  const useBackslash = filePath.includes('\\')
  const norm = normalizeSlashes(filePath)
  const match = /^(.*\/src)(?:\/|$)/i.exec(norm)
  if (!match) {
    return null
  }
  return useBackslash ? match[1].replace(/\//g, '\\') : match[1]
}

function buildImportCandidateFilePaths(basePath: string): string[] {
  const sep = basePath.includes('\\') ? '\\' : '/'
  const candidates: string[] = []

  const extMatch = /\.(tsx?|jsx?|d\.ts|mts|cts|mjs|cjs|json|css|scss|less|svg|md)$/i.exec(basePath)
  if (extMatch) {
    if (/\.(m|c)?jsx?$/i.test(extMatch[0])) {
      const stem = basePath.slice(0, -extMatch[0].length)
      candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.d.ts`, `${stem}.mts`, `${stem}.cts`)
    }
    candidates.push(basePath)
    return candidates
  }

  for (const ext of RESOLVABLE_EXTENSIONS) {
    candidates.push(`${basePath}${ext}`)
  }
  for (const ext of RESOLVABLE_EXTENSIONS) {
    candidates.push(`${basePath}${sep}index${ext}`)
  }
  return candidates
}

export async function resolveImportSpecifierToFilePath(
  ctx: ModelWorkspaceContext,
  specifier: string
): Promise<string | null> {
  const trimmed = specifier.trim()
  if (!trimmed || trimmed.startsWith('node:') || /^[a-z]+:\/\//i.test(trimmed)) {
    return null
  }

  const cacheKey = `${ctx.filePath}::${trimmed}`
  const now = Date.now()
  const cached = resolvedImportPathCache.get(cacheKey)
  if (cached && now - cached.timestamp < IMPORT_PATH_CACHE_TTL_MS) {
    return cached.filePath
  }

  const baseDirsToTry: string[] = []
  if (trimmed.startsWith('.')) {
    baseDirsToTry.push(joinAndNormalizePath(dirnameOf(ctx.filePath), trimmed))
  } else if (trimmed.startsWith('@/') || trimmed.startsWith('~/')) {
    const subPath = trimmed.slice(2)
    const nearestSrc = findNearestSrcAncestor(ctx.filePath)
    if (nearestSrc) {
      baseDirsToTry.push(joinAndNormalizePath(nearestSrc, subPath))
    }
    baseDirsToTry.push(joinAndNormalizePath(ctx.worktreePath, `src/${subPath}`))
    baseDirsToTry.push(joinAndNormalizePath(ctx.worktreePath, `src/renderer/src/${subPath}`))
    baseDirsToTry.push(joinAndNormalizePath(ctx.worktreePath, subPath))
  } else {
    const nearestSrc = findNearestSrcAncestor(ctx.filePath)
    if (nearestSrc) {
      baseDirsToTry.push(joinAndNormalizePath(nearestSrc, trimmed))
    }
    baseDirsToTry.push(joinAndNormalizePath(ctx.worktreePath, trimmed))
    baseDirsToTry.push(joinAndNormalizePath(ctx.worktreePath, `src/${trimmed}`))
    baseDirsToTry.push(joinAndNormalizePath(ctx.worktreePath, `packages/${trimmed}`))
  }

  const seenCandidates = new Set<string>()
  const candidatePaths: string[] = []
  for (const base of baseDirsToTry) {
    for (const candidate of buildImportCandidateFilePaths(base)) {
      if (!seenCandidates.has(candidate) && candidatePaths.length < 120) {
        seenCandidates.add(candidate)
        candidatePaths.push(candidate)
      }
    }
  }

  if (candidatePaths.length === 0) {
    resolvedImportPathCache.set(cacheKey, { timestamp: now, filePath: null })
    return null
  }

  try {
    if (typeof window.api?.fs?.pathsExist === 'function') {
      const results = await window.api.fs.pathsExist({
        filePaths: candidatePaths,
        connectionId: ctx.connectionId
      })
      for (let i = 0; i < results.length; i++) {
        const item = results[i]
        if (item && 'exists' in item && item.exists) {
          const found = candidatePaths[i]
          resolvedImportPathCache.set(cacheKey, { timestamp: Date.now(), filePath: found })
          return found
        }
      }
    } else if (typeof window.api?.fs?.pathExists === 'function') {
      const checks = await Promise.all(
        candidatePaths.map((filePath) =>
          window.api.fs.pathExists({ filePath, connectionId: ctx.connectionId }).catch(() => false)
        )
      )
      const idx = checks.findIndex(Boolean)
      if (idx !== -1) {
        const found = candidatePaths[idx]
        resolvedImportPathCache.set(cacheKey, { timestamp: Date.now(), filePath: found })
        return found
      }
    }
  } catch {
    // Fall through on error
  }

  resolvedImportPathCache.set(cacheKey, { timestamp: Date.now(), filePath: null })
  return null
}
