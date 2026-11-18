import type * as Monaco from 'monaco-editor'
import { queryHostTypeScriptDocument } from './monaco-ts-host-navigation'
import { resolveModelContext, TS_WORKSPACE_LANGUAGE_IDS } from './monaco-ts-workspace-models'

export function registerWorkspaceTypeScriptHover(monaco: typeof Monaco): void {
  monaco.languages.registerHoverProvider(TS_WORKSPACE_LANGUAGE_IDS, {
    async provideHover(model, position, token) {
      const version = model.getVersionId()
      const cancelled = (): boolean =>
        token.isCancellationRequested || model.isDisposed() || model.getVersionId() !== version
      const context = resolveModelContext(model.uri.toString())
      if (context && !context.historical && !context.isHistorical?.() && !cancelled()) {
        const controller = new AbortController()
        const subscription = token.onCancellationRequested(() => controller.abort())
        const native = await queryHostTypeScriptDocument(
          monaco,
          context,
          model,
          'hover',
          position,
          controller.signal
        )
          .catch(() => null)
          .finally(() => subscription.dispose())
        if (cancelled()) {
          return null
        }
        if (native) {
          return native.hover
            ? { contents: [{ value: native.hover.markdown }], range: native.hover.range }
            : null
        }
      }
      if (cancelled()) {
        return null
      }
      const { QuickInfoAdapter } =
        await import('monaco-editor/esm/vs/language/typescript/tsMode.js')
      const worker = await (model.getLanguageId().startsWith('javascript')
        ? monaco.typescript.getJavaScriptWorker()
        : monaco.typescript.getTypeScriptWorker())
      return cancelled() ? null : new QuickInfoAdapter(worker).provideHover(model, position, token)
    }
  })
}
