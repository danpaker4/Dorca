import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { parseStableVersion } from './dorca-release-plan.mjs'

export const DORCA_MAC_ARCHES = ['x64', 'arm64']

export async function describeDorcaMacInstaller(filename, version, arch) {
  parseStableVersion(version)
  if (!DORCA_MAC_ARCHES.includes(arch) || basename(filename) !== `dorca-macos-${arch}.dmg`) {
    throw new Error('Unexpected Dorca Mac installer name or architecture')
  }
  const info = await stat(filename)
  if (!info.isFile() || !info.size) {
    throw new Error('The Mac installer is empty or missing')
  }
  const sha256 = createHash('sha256')
  const sha512 = createHash('sha512')
  for await (const chunk of createReadStream(filename)) {
    sha256.update(chunk)
    sha512.update(chunk)
  }
  return {
    version,
    arch,
    url: basename(filename),
    size: info.size,
    sha256: sha256.digest('hex'),
    sha512: sha512.digest('base64')
  }
}

export function createDorcaMacManifest(version, descriptions, assets) {
  parseStableVersion(version)
  const files = DORCA_MAC_ARCHES.map((arch) => {
    const description = descriptions.find((entry) => entry.arch === arch)
    const expectedName = `dorca-macos-${arch}.dmg`
    const published = assets.find((entry) => entry.name === expectedName)
    if (!description || description.version !== version || description.url !== expectedName) {
      throw new Error(`Missing installer evidence for ${arch}`)
    }
    if (
      !Number.isSafeInteger(description.size) ||
      description.size <= 0 ||
      !/^[0-9a-f]{64}$/.test(description.sha256) ||
      !/^[A-Za-z0-9+/]{86}==$/.test(description.sha512)
    ) {
      throw new Error(`Invalid installer evidence for ${arch}`)
    }
    if (
      !published ||
      published.size !== description.size ||
      published.digest !== `sha256:${description.sha256}`
    ) {
      throw new Error(`Published ${arch} installer does not match the verified build`)
    }
    return description
  })
  return [
    `version: ${version}`,
    'files:',
    ...files.flatMap((file) => [
      `  - url: ${file.url}`,
      `    sha512: ${file.sha512}`,
      `    size: ${file.size}`
    ]),
    `path: ${files[0].url}`,
    `sha512: ${files[0].sha512}`,
    ''
  ].join('\n')
}
