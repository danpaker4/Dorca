export const TYPESCRIPT_NAVIGATION_KINDS = [
  'prepare',
  'definition',
  'references',
  'hover',
  'diagnostics'
] as const

export type TypeScriptNavigationKind = (typeof TYPESCRIPT_NAVIGATION_KINDS)[number]

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
  range: TypeScriptDocumentRange
}

export type TypeScriptDocumentRange = {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export type TypeScriptDocumentHover = { markdown: string; range?: TypeScriptDocumentRange }

export type TypeScriptDocumentError = {
  range: TypeScriptDocumentRange
  message: string
  code?: string
}

export type TypeScriptNavigationResult = {
  available: boolean
  locations: TypeScriptNavigationLocation[]
  hover?: TypeScriptDocumentHover
  errors?: TypeScriptDocumentError[]
}
