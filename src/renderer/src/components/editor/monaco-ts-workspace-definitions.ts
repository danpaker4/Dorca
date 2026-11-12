import type * as Monaco from 'monaco-editor'
import { isTsOrJsLanguageId } from './monaco-ts-workspace-models'
import { queryWorkspaceSymbol } from './monaco-ts-workspace-navigation'

export function registerWorkspaceDefinitions(
  monaco: Pick<typeof Monaco, 'languages' | 'editor' | 'Uri'>
): void {
  const register = monaco.languages.registerDefinitionProvider.bind(monaco.languages)
  monaco.languages.registerDefinitionProvider = (selector, provider) => {
    if (typeof selector !== 'string' || !isTsOrJsLanguageId(selector)) {
      return register(selector, provider)
    }
    return register(selector, {
      provideDefinition: async (model, position, token) =>
        (await queryWorkspaceSymbol(monaco, model, position, token, 'definition')) ??
        provider.provideDefinition(model, position, token)
    })
  }
}
