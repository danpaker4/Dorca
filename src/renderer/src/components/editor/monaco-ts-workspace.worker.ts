import { start } from 'monaco-editor/esm/vs/editor/editor.worker.start.js'
import { createTypeScriptProjectQuery } from './monaco-ts-project-service'

start(() => ({ query: createTypeScriptProjectQuery() }))
