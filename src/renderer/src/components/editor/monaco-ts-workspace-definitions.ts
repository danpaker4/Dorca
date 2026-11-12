import type * as Monaco from 'monaco-editor'
import { TS_WORKSPACE_LANGUAGE_IDS } from './monaco-ts-workspace-models'
import { queryWorkspaceSymbol } from './monaco-ts-workspace-navigation'

export function registerWorkspaceDefinitions(
  monaco: Pick<typeof Monaco, 'languages' | 'editor' | 'Uri'>
): void {
  monaco.languages.registerDefinitionProvider(TS_WORKSPACE_LANGUAGE_IDS, {
    provideDefinition: (model, position, token) =>
      queryWorkspaceSymbol(monaco, model, position, token, 'definition')
  })
}
