// Keep these Monaco snippet test declarations ambient by leaving this file a script.
declare module 'monaco-editor/esm/vs/editor/contrib/snippet/browser/snippetVariables.js' {
  export class ModelBasedVariableResolver {
    constructor(labelService: unknown, model: unknown)
    resolve(variable: { name: string }): string | undefined
  }
}

declare module 'monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js' {
  export const StandaloneServices: { get(serviceId: unknown): unknown }
}

declare module 'monaco-editor/esm/vs/platform/label/common/label.js' {
  export const ILabelService: unknown
}
