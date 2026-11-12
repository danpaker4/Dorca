import { start } from 'monaco-editor/esm/vs/editor/editor.worker.start.js'
import { queryTypeScriptProject } from './monaco-ts-project-service'

start(() => ({ query: queryTypeScriptProject }))
