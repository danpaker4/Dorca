const { copyFileSync, chmodSync, mkdirSync, existsSync, readdirSync } = require('node:fs')
const { createRequire } = require('node:module')
const { dirname, join } = require('node:path')
const {
  TYPESCRIPT_LANGUAGE_SERVER_DIRECTORY,
  typeScriptLanguageServerBinary,
  ORCAD_TYPESCRIPT_LIBRARY_ARTIFACTS
} = require('../src/shared/orcad-artifacts.ts')

function typeScriptLanguageServerFiles(platform, arch, projectDir = join(__dirname, '..')) {
  const require = createRequire(join(projectDir, 'package.json'))
  const compiler = require.resolve('typescript/package.json')
  const native = createRequire(compiler).resolve(
    `@typescript/typescript-${platform}-${arch}/package.json`
  )
  const libraryDir = join(dirname(native), 'lib')
  const libraries = readdirSync(libraryDir)
    .filter((name) => /^lib.*\.d\.ts$/.test(name))
    .sort()
  const expected = ORCAD_TYPESCRIPT_LIBRARY_ARTIFACTS.map((name) =>
    name.slice(TYPESCRIPT_LANGUAGE_SERVER_DIRECTORY.length + 1)
  )
  if (libraries.join('\0') !== expected.join('\0')) {
    throw new Error(
      'Run node config/scripts/assets/typescript-libraries/generate-typescript-library-artifacts.mjs after updating TypeScript'
    )
  }
  const binary = typeScriptLanguageServerBinary(platform)
  return [
    { source: join(libraryDir, binary), filename: binary, executable: true },
    ...libraries.map((filename) => ({
      source: join(libraryDir, filename),
      filename,
      executable: false
    })),
    { source: join(dirname(compiler), 'LICENSE'), filename: 'LICENSE', executable: false },
    { source: join(dirname(compiler), 'NOTICE.txt'), filename: 'NOTICE.txt', executable: false }
  ]
}

function copyPackagedTypeScriptLanguageServer(destinationRoot, platform, arch, projectDir) {
  let files
  try {
    files = typeScriptLanguageServerFiles(platform, arch, projectDir)
  } catch (error) {
    // Packaging fixtures can call afterPack without beforePack's target dependency admission.
    if (error.code === 'MODULE_NOT_FOUND') {
      return
    }
    throw error
  }
  const destination = join(destinationRoot, TYPESCRIPT_LANGUAGE_SERVER_DIRECTORY)
  mkdirSync(destination, { recursive: true })
  for (const file of files) {
    const target = join(destination, file.filename)
    copyFileSync(file.source, target)
    if (file.executable) {
      chmodSync(target, 0o755)
    }
  }
}

function assertTypeScriptLanguageServerInstalled(platform, arch, projectDir) {
  let files
  try {
    files = typeScriptLanguageServerFiles(platform, arch, projectDir)
  } catch (error) {
    throw new Error(
      `TypeScript language server for ${platform}-${arch} is missing; run pnpm install:release. ${error.message}`
    )
  }
  for (const file of files) {
    if (!existsSync(file.source)) {
      throw new Error(`TypeScript language server resource is missing: ${file.source}`)
    }
  }
}

module.exports = {
  typeScriptLanguageServerFiles,
  copyPackagedTypeScriptLanguageServer,
  assertTypeScriptLanguageServerInstalled
}
