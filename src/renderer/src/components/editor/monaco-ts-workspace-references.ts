import type * as Monaco from 'monaco-editor'
import { TS_WORKSPACE_LANGUAGE_IDS } from './monaco-ts-workspace-models'
import { queryWorkspaceSymbol } from './monaco-ts-workspace-navigation'

export function registerWorkspaceReferences(
  monaco: Pick<typeof Monaco, 'languages' | 'editor' | 'Uri'>
): void {
  monaco.languages.registerReferenceProvider(TS_WORKSPACE_LANGUAGE_IDS, {
    provideReferences: (model, position, context, token) =>
      queryWorkspaceSymbol(monaco, model, position, token, 'references', context.includeDeclaration)
  })
}
