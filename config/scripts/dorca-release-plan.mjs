const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function parseStableVersion(version) {
  if (typeof version !== 'string' || !STABLE_VERSION.test(version)) {
    throw new Error(`Expected a stable version such as 2.0.1, received ${version}`)
  }
  const parts = version.split('.').map(Number)
  if (!parts.every(Number.isSafeInteger)) {
    throw new Error('Version exceeds the supported range')
  }
  return parts
}

export function planDorcaRelease(current, upstreamTag, requestedVersion, scheduled = false) {
  if (!/^v\d+\.\d+\.\d+$/.test(upstreamTag)) {
    throw new Error('Only official stable Orca release tags can be integrated')
  }
  parseStableVersion(upstreamTag.slice(1))
  const previous = parseStableVersion(current.version)
  if (scheduled && upstreamTag === current.upstreamTag) {
    return null
  }
  const version = requestedVersion || `${previous[0]}.${previous[1]}.${previous[2] + 1}`
  const next = parseStableVersion(version)
  const changedIndex = next.findIndex((value, index) => value !== previous[index])
  if (changedIndex !== -1 && next[changedIndex] < previous[changedIndex]) {
    throw new Error('A Dorca release cannot downgrade the installed version')
  }
  return { version, upstreamTag }
}

export function resolvePackageVersionConflict(source) {
  let count = 0
  const resolved = source.replace(
    /^<<<<<<< .+\r?\n([\s\S]*?)^=======\r?\n([\s\S]*?)^>>>>>>> .+(?:\r?\n|$)/gm,
    (_conflict, ours, theirs) => {
      const allowed = /^\s*"(?:version|productName)":\s*"[^"]+",?\s*$/
      const lines = (value) => value.trimEnd().split(/\r?\n/)
      if (![...lines(ours), ...lines(theirs)].every((line) => allowed.test(line))) {
        throw new Error('package.json has a conflict beyond the known version/branding fields')
      }
      const versionLine = lines(theirs).find((line) => /"version":/.test(line))
      if (!versionLine || !/"version":/.test(ours)) {
        throw new Error('The conflict does not contain both package versions')
      }
      count += 1
      return `  "productName": "Dorca",\n${versionLine}\n`
    }
  )
  if (!count || /^(<<<<<<<|=======|>>>>>>>)/m.test(resolved)) {
    throw new Error('Unresolved package.json conflicts require manual integration')
  }
  JSON.parse(resolved)
  return resolved
}
