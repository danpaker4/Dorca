export const TYPESCRIPT_HIGHLIGHT_TOKEN_TYPES = [
  'type',
  'variable',
  'variable.parameter',
  'variable.readonly',
  'function',
  'keyword.flow'
] as const

export const TYPESCRIPT_HIGHLIGHT_CHARACTER_LIMIT = 100_000

export type TypeScriptHighlightWorker = {
  getHighlightClassifications(fileName: string): Promise<number[]>
}
