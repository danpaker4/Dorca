import { TypeScriptWorker } from 'monaco-editor/esm/vs/language/typescript/tsWorker.js'
import { typescript as ts } from 'monaco-editor/esm/vs/language/typescript/lib/typescriptServices.js'
import {
  TYPESCRIPT_HIGHLIGHT_CHARACTER_LIMIT,
  TYPESCRIPT_HIGHLIGHT_TOKEN_TYPES
} from './typescript-highlight-protocol'

type HighlightType = (typeof TYPESCRIPT_HIGHLIGHT_TOKEN_TYPES)[number]
type HighlightSpan = [start: number, length: number, type: number]

const TOKEN_INDEX = new Map<string, number>(
  TYPESCRIPT_HIGHLIGHT_TOKEN_TYPES.map((type, index) => [type, index])
)

// TypeScript's 2020 classification format packs the symbol kind above eight modifier bits.
const SEMANTIC_TYPES: readonly HighlightType[] = [
  'type',
  'type',
  'type',
  'type',
  'type',
  'type',
  'variable.parameter',
  'variable',
  'variable.readonly',
  'variable',
  'function',
  'function'
]
const READONLY_MODIFIER = 1 << 3
const CONTROL_FLOW = new Set([
  'as',
  'await',
  'break',
  'case',
  'catch',
  'continue',
  'debugger',
  'default',
  'do',
  'else',
  'export',
  'finally',
  'for',
  'from',
  'if',
  'import',
  'return',
  'switch',
  'throw',
  'try',
  'while',
  'with',
  'yield'
])

function semanticHighlightSpans(classifications: readonly number[]): HighlightSpan[] {
  const spans: HighlightSpan[] = []
  for (let offset = 0; offset < classifications.length; offset += 3) {
    const classification = classifications[offset + 2]
    const symbolType = (classification >> 8) - 1
    let type = SEMANTIC_TYPES[symbolType]
    if (!type) {
      continue
    }
    if (symbolType === 7 && (classification & READONLY_MODIFIER) !== 0) {
      type = 'variable.readonly'
    }
    spans.push([classifications[offset], classifications[offset + 1], TOKEN_INDEX.get(type)!])
  }
  return spans
}

function controlFlowSpans(text: string, classifications: readonly number[]): HighlightSpan[] {
  const spans: HighlightSpan[] = []
  for (let offset = 0; offset < classifications.length; offset += 3) {
    const start = classifications[offset]
    const length = classifications[offset + 1]
    if (
      classifications[offset + 2] === ts.ClassificationType.keyword &&
      CONTROL_FLOW.has(text.slice(start, start + length))
    ) {
      spans.push([start, length, TOKEN_INDEX.get('keyword.flow')!])
    }
  }
  return spans
}

export class TypeScriptHighlightWorker extends TypeScriptWorker {
  async getHighlightClassifications(fileName: string): Promise<number[]> {
    const text = this.readFile(fileName)
    if (text === undefined || text.length > TYPESCRIPT_HIGHLIGHT_CHARACTER_LIMIT) {
      return []
    }
    const service = this.getLanguageService()
    const span = { start: 0, length: text.length }
    const semantic = service.getEncodedSemanticClassifications(
      fileName,
      span,
      ts.SemanticClassificationFormat.TwentyTwenty
    ).spans
    const syntactic = service.getEncodedSyntacticClassifications(fileName, span).spans
    return [...semanticHighlightSpans(semantic), ...controlFlowSpans(text, syntactic)]
      .sort((a, b) => a[0] - b[0])
      .flat()
  }
}
