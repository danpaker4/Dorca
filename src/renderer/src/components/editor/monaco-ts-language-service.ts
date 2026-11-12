import { TypeScriptWorker } from 'monaco-editor/esm/vs/language/typescript/tsWorker.js'
import { typescript as ts } from 'monaco-editor/esm/vs/language/typescript/lib/typescriptServices.js'
import { isCaseInsensitiveRuntimeRoot } from '../../../../shared/cross-platform-path'
import type { CompilerOptions, IScriptSnapshot, ScriptKind, LanguageService } from 'typescript-api'
import type { ProjectFiles } from './monaco-ts-project-files'

export function createProjectService(
  files: ProjectFiles,
  roots: string[],
  options: CompilerOptions
): LanguageService {
  class ProjectLanguageService extends TypeScriptWorker {
    constructor() {
      super(
        { getMirrorModels: () => [] },
        {
          compilerOptions: options,
          extraLibs: {},
          inlayHintsOptions: {}
        }
      )
    }

    getCurrentDirectory(): string {
      return files.root
    }
    useCaseSensitiveFileNames(): boolean {
      return !isCaseInsensitiveRuntimeRoot(files.root)
    }
    getScriptFileNames(): string[] {
      return roots
    }
    getScriptVersion(): string {
      return '1'
    }
    readFile(name: string): string | undefined {
      return super.readFile(name) ?? files.readFile(name)
    }
    fileExists(name: string): boolean {
      return super.readFile(name) !== undefined || files.fileExists(name)
    }
    getScriptSnapshot(name: string): IScriptSnapshot | undefined {
      const content = this.readFile(name)
      return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content)
    }
    getScriptKind(name: string): ScriptKind {
      if (/\.tsx$/i.test(name)) {
        return ts.ScriptKind.TSX
      }
      if (/\.jsx$/i.test(name)) {
        return ts.ScriptKind.JSX
      }
      if (/\.json$/i.test(name)) {
        return ts.ScriptKind.JSON
      }
      return /\.[cm]?js$/i.test(name) ? ts.ScriptKind.JS : ts.ScriptKind.TS
    }
  }
  return new ProjectLanguageService().getLanguageService()
}
