import type * as Monaco from 'monaco-editor'
import { isTsOrJsLanguageId } from './monaco-ts-workspace-models'
import { queryWorkspaceSymbol } from './monaco-ts-workspace-navigation'

export function registerWorkspaceReferences(
  monaco: Pick<typeof Monaco, 'languages' | 'editor' | 'Uri'>
): void {
  const register = monaco.languages.registerReferenceProvider.bind(monaco.languages)
  monaco.languages.registerReferenceProvider = (selector, provider) => {
    if (typeof selector !== 'string' || !isTsOrJsLanguageId(selector)) {
      return register(selector, provider)
    }
    return register(selector, {
      provideReferences: async (model, position, context, token) =>
        (await queryWorkspaceSymbol(
          monaco,
          model,
          position,
          token,
          'references',
          context.includeDeclaration
        )) ?? provider.provideReferences(model, position, context, token)
    })
  }
}
