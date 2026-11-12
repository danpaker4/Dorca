import { typescript as ts } from 'monaco-editor/esm/vs/language/typescript/lib/typescriptServices.js'
import type { LanguageService } from 'typescript-api'
import {
  isInsideProject,
  normalizeProjectPath,
  type TypeScriptProjectQuery,
  type TypeScriptProjectResult
} from './monaco-ts-project-protocol'

export function queryProjectLocations(
  request: TypeScriptProjectQuery,
  service: LanguageService,
  root: string,
  missingFiles: string[]
): TypeScriptProjectResult {
  const filePath = normalizeProjectPath(request.filePath)
  const groups =
    request.kind === 'references' ? (service.findReferences(filePath, request.offset) ?? []) : []
  const referenceNames = new Set<string>()
  const program = service.getProgram()
  for (const group of groups) {
    for (const entry of group.references) {
      const source = program?.getSourceFile(entry.fileName)
      if (source) {
        const scanner = ts.createScanner(
          ts.ScriptTarget.ESNext,
          true,
          ts.LanguageVariant.Standard,
          source.text.slice(entry.textSpan.start, entry.textSpan.start + entry.textSpan.length)
        )
        scanner.scan()
        const name = scanner.getTokenValue()
        if (name) {
          referenceNames.add(name)
        }
      }
    }
  }
  const entries =
    request.kind === 'definition'
      ? (service.getDefinitionAtPosition(filePath, request.offset) ?? []).filter(
          (entry) => entry.kind !== ts.ScriptElementKind.alias
        )
      : groups.flatMap((group) =>
          group.references.filter((entry) => request.includeDeclaration || !entry.isDefinition)
        )
  const locations: TypeScriptProjectResult['locations'] = []
  for (const entry of entries) {
    if (!isInsideProject(root, normalizeProjectPath(entry.fileName))) {
      continue
    }
    const source = program?.getSourceFile(entry.fileName)
    if (!source) {
      continue
    }
    const start = source.getLineAndCharacterOfPosition(entry.textSpan.start)
    const end = source.getLineAndCharacterOfPosition(entry.textSpan.start + entry.textSpan.length)
    locations.push({
      filePath: entry.fileName,
      range: {
        startLineNumber: start.line + 1,
        startColumn: start.character + 1,
        endLineNumber: end.line + 1,
        endColumn: end.character + 1
      }
    })
  }
  return { missingFiles, missingPaths: [], referenceNames: [...referenceNames], locations }
}
