export type TypeScriptNavigationKind = 'prepare' | 'definition' | 'references'

export type TypeScriptNavigationRequest = {
  rootPath: string
  filePath: string
  kind: TypeScriptNavigationKind
  lineNumber: number
  column: number
  includeDeclaration: boolean
  buffers: { filePath: string; content: string; languageId: string }[]
}

export type TypeScriptNavigationLocation = {
  filePath: string
  range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }
}

export type TypeScriptNavigationResult = {
  available: boolean
  locations: TypeScriptNavigationLocation[]
}
