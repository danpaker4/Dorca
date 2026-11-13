declare module 'monaco-editor/esm/vs/editor/editor.worker.start.js' {
  export function start(create: () => object): void
}

declare module 'monaco-editor/esm/vs/language/typescript/tsWorker.js' {
  import type { URI } from 'monaco-editor/esm/vs/base/common/uri.js'
  import type { LanguageService } from 'typescript-api'
  export class TypeScriptWorker {
    constructor(
      context: { getMirrorModels(): { uri: URI; version: number; getValue(): string }[] },
      createData: {
        compilerOptions: Record<string, unknown>
        extraLibs: Record<string, unknown>
        inlayHintsOptions: Record<string, unknown>
      }
    )
    getLanguageService(): LanguageService
    readFile(fileName: string): string | undefined
    getScriptKind(fileName: string): number
    getQuickInfoAtPosition(
      fileName: string,
      position: number
    ): Promise<{ displayParts?: readonly { text: string }[] } | undefined>
    getDefinitionAtPosition(
      fileName: string,
      position: number
    ): Promise<readonly { fileName: string }[] | undefined>
  }
}

declare module 'monaco-editor/esm/vs/language/typescript/lib/typescriptServices.js' {
  import type * as TypeScript from 'typescript-api'
  export const ScriptKind: typeof TypeScript.ScriptKind
  export const typescript: typeof TypeScript & {
    matchFiles: (
      path: string,
      extensions: readonly string[] | undefined,
      excludes: readonly string[] | undefined,
      includes: readonly string[] | undefined,
      caseSensitive: boolean,
      currentDirectory: string,
      depth: number | undefined,
      getEntries: (directory: string) => { files: string[]; directories: string[] },
      realpath: (path: string) => string
    ) => string[]
  }
}

declare module 'monaco-editor/esm/vs/common/initialize.js' {
  import type { TypeScriptWorker } from 'monaco-editor/esm/vs/language/typescript/tsWorker.js'
  export function initialize(
    create: (...args: ConstructorParameters<typeof TypeScriptWorker>) => TypeScriptWorker
  ): void
}
