import { initialize } from 'monaco-editor/esm/vs/common/initialize.js'
import { TypeScriptHighlightWorker } from './typescript-highlight-worker'

self.onmessage = () => {
  initialize((context, createData) => new TypeScriptHighlightWorker(context, createData))
}
