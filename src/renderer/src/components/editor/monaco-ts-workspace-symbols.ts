import type * as Monaco from 'monaco-editor'

export function isCommentLine(lineContent: string): boolean {
  const trimmed = lineContent.trim()
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('*/')
  )
}

export function isExportedDeclarationLine(lineContent: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const exportDeclRegex = new RegExp(
    `\\bexport\\s+(?:default\\s+)?(?:declare\\s+)?(?:async\\s+)?(?:function\\*?\\s+|const\\s+|let\\s+|var\\s+|class\\s+|interface\\s+|type\\s+|enum\\s+)(${escaped})\\b`
  )
  return exportDeclRegex.test(lineContent)
}

type ModuleSpecifierMatch = {
  specifier: string
  startColumn: number
  endColumn: number
}

export function extractModuleSpecifierAtPosition(
  lineContent: string,
  column: number
): ModuleSpecifierMatch | null {
  const patterns = [
    /\b(?:from|import)\s+(['"])([^'"]+)\1/g,
    /\b(?:import|require)\s*\(\s*(['"])([^'"]+)\1\s*\)/g
  ]
  for (const regex of patterns) {
    let match: RegExpExecArray | null
    while ((match = regex.exec(lineContent)) !== null) {
      const fullMatch = match[0]
      const quote = match[1]
      const specifier = match[2]
      const quoteStartIdx = match.index + fullMatch.indexOf(quote)
      const quoteEndIdx = quoteStartIdx + 1 + specifier.length
      const startQuoteCol = quoteStartIdx + 1
      const endQuoteCol = quoteEndIdx + 2
      if (column >= startQuoteCol && column <= endQuoteCol) {
        return {
          specifier,
          startColumn: quoteStartIdx + 2,
          endColumn: quoteEndIdx + 1
        }
      }
    }
  }
  return null
}

export function findImportForIdentifierInModel(
  model: Monaco.editor.ITextModel,
  identifier: string
): { specifier: string; importedSymbol: string; isDefault: boolean } | null {
  const maxLines = Math.min(model.getLineCount(), 250)
  const headerText = model.getValueInRange({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: maxLines,
    endColumn: model.getLineMaxColumn(maxLines)
  })

  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const importStmtRegex = /\bimport\s+(?:type\s+)?([\s\S]*?)\s+from\s+(['"])([^'"]+)\2/g
  let match: RegExpExecArray | null
  while ((match = importStmtRegex.exec(headerText)) !== null) {
    const clause = match[1].trim()
    const specifier = match[3]

    // Named imports: { Foo, Bar as Identifier }
    const braceMatch = /\{([\s\S]*?)\}/.exec(clause)
    if (braceMatch) {
      const namedParts = braceMatch[1].split(',')
      for (const rawPart of namedParts) {
        const part = rawPart.replace(/\btype\s+/, '').trim()
        if (!part) {
          continue
        }
        const asMatch = new RegExp(`^([A-Za-z0-9_$]+)\\s+as\\s+${escaped}$`).exec(part)
        if (asMatch) {
          return { specifier, importedSymbol: asMatch[1], isDefault: false }
        }
        if (part === identifier) {
          return { specifier, importedSymbol: identifier, isDefault: false }
        }
      }
    }

    // Namespace import: * as Identifier
    if (new RegExp(`\\*\\s+as\\s+${escaped}\\b`).test(clause)) {
      return { specifier, importedSymbol: identifier, isDefault: true }
    }

    // Default import: import Identifier from '...' or import Identifier, { ... } from '...'
    const withoutBraces = clause
      .replace(/\{[\s\S]*?\}/, '')
      .replace(/,/g, '')
      .trim()
    if (withoutBraces === identifier) {
      return { specifier, importedSymbol: identifier, isDefault: true }
    }
  }
  return null
}

export function findExportRangeInTargetModel(
  targetModel: Monaco.editor.ITextModel,
  symbolName: string,
  isDefault: boolean
): Monaco.IRange {
  const lineCount = targetModel.getLineCount()
  const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const wordRegex = new RegExp(`\\b(${escaped})\\b`)

  for (let lineNumber = 1; lineNumber <= lineCount; lineNumber++) {
    const line = targetModel.getLineContent(lineNumber)
    if (isCommentLine(line)) {
      continue
    }
    if (isExportedDeclarationLine(line, symbolName)) {
      const m = wordRegex.exec(line)
      const startCol = m ? m.index + 1 : 1
      return {
        startLineNumber: lineNumber,
        startColumn: startCol,
        endLineNumber: lineNumber,
        endColumn: startCol + symbolName.length
      }
    }
    if (isDefault && /\bexport\s+default\b/.test(line)) {
      const m = wordRegex.exec(line) ?? /\bdefault\b/.exec(line)
      const startCol = m ? m.index + 1 : 1
      const len = m ? m[0].length : 1
      return {
        startLineNumber: lineNumber,
        startColumn: startCol,
        endLineNumber: lineNumber,
        endColumn: startCol + len
      }
    }
  }

  // Fallback: any mention of export { ... symbolName ... }
  for (let lineNumber = 1; lineNumber <= lineCount; lineNumber++) {
    const line = targetModel.getLineContent(lineNumber)
    if (isCommentLine(line)) {
      continue
    }
    if (/\bexport\b/.test(line) && wordRegex.test(line)) {
      const m = wordRegex.exec(line)!
      return {
        startLineNumber: lineNumber,
        startColumn: m.index + 1,
        endLineNumber: lineNumber,
        endColumn: m.index + 1 + symbolName.length
      }
    }
  }

  return {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 1
  }
}

export function deduplicateLocations(
  locations: Monaco.languages.Location[]
): Monaco.languages.Location[] {
  const seen = new Set<string>()
  const unique: Monaco.languages.Location[] = []
  for (const loc of locations) {
    const key = `${loc.uri.toString()}:${loc.range.startLineNumber}:${loc.range.startColumn}:${loc.range.endLineNumber}:${loc.range.endColumn}`
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(loc)
    }
  }
  return unique
}

export function normalizeDefinitionLinksToLocations(
  raw: Monaco.languages.Definition | Monaco.languages.LocationLink[] | null | undefined
): Monaco.languages.Location[] {
  if (!raw) {
    return []
  }
  const items: (Monaco.languages.Location | Monaco.languages.LocationLink)[] = Array.isArray(raw)
    ? raw
    : [raw]
  return items.map((item): Monaco.languages.Location => ({
    uri: item.uri,
    range:
      'targetSelectionRange' in item && item.targetSelectionRange
        ? item.targetSelectionRange
        : item.range
  }))
}
