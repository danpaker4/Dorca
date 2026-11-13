import { expect, it } from 'vitest'
import { URI } from 'monaco-editor/esm/vs/base/common/uri.js'
import { typescript as ts } from 'monaco-editor/esm/vs/language/typescript/lib/typescriptServices.js'
import { TypeScriptHighlightWorker } from './typescript-highlight-worker'
import { TYPESCRIPT_HIGHLIGHT_TOKEN_TYPES } from './typescript-highlight-protocol'

function createWorker(fileName: string, text: string): TypeScriptHighlightWorker {
  return new TypeScriptHighlightWorker(
    { getMirrorModels: () => [{ uri: URI.parse(fileName), version: 1, getValue: () => text }] },
    {
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        allowJs: true,
        jsx: ts.JsxEmit.Preserve
      },
      extraLibs: {},
      inlayHintsOptions: {}
    }
  )
}

async function highlightWords(fileName: string, text: string): Promise<[string, string][]> {
  const spans = await createWorker(fileName, text).getHighlightClassifications(fileName)
  const words: [string, string][] = []
  for (let index = 0; index < spans.length; index += 3) {
    words.push([
      text.slice(spans[index], spans[index] + spans[index + 1]),
      TYPESCRIPT_HIGHLIGHT_TOKEN_TYPES[spans[index + 2]]
    ])
  }
  return words
}

it('separates control flow, callable properties, constants and parameters in the reference code', async () => {
  const words = await highlightWords(
    'file:///reference.ts',
    `interface PollerConfig { mainDb: string }
export class InfrastructureFactory {
  private readonly config: PollerConfig;
  constructor(config: PollerConfig) { this.config = config; }
  createMainInfra = () => {
    const isMongoMainDb = this.config.mainDb === "mongo";
    let persistenceInfrastructure = "redis";
    return isMongoMainDb ? this.createPersistenceInfrastructure() : persistenceInfrastructure;
  };
  private createPersistenceInfrastructure = () => "mongo";
}`
  )
  expect(words).toEqual(
    expect.arrayContaining([
      ['export', 'keyword.flow'],
      ['InfrastructureFactory', 'type'],
      ['PollerConfig', 'type'],
      ['config', 'variable.parameter'],
      ['config', 'variable'],
      ['createMainInfra', 'function'],
      ['isMongoMainDb', 'variable.readonly'],
      ['persistenceInfrastructure', 'variable'],
      ['return', 'keyword.flow'],
      ['createPersistenceInfrastructure', 'function']
    ])
  )
  expect(words.filter(([word]) => word === 'isMongoMainDb')).toEqual([
    ['isMongoMainDb', 'variable.readonly'],
    ['isMongoMainDb', 'variable.readonly']
  ])
})

it('preserves JavaScript and JSX code categories without treating text or property names as control flow', async () => {
  const words = await highlightWords(
    'file:///component.jsx',
    `const message = "export return";
// return export
export function View({ value }) {
  const object = { return: value };
  return <section title="return">export {object.return}</section>;
}`
  )
  expect(words.filter(([, type]) => type === 'keyword.flow')).toEqual([
    ['export', 'keyword.flow'],
    ['return', 'keyword.flow']
  ])
  expect(words).toEqual(
    expect.arrayContaining([
      ['View', 'function'],
      ['value', 'variable.parameter'],
      ['object', 'variable.readonly']
    ])
  )
})
