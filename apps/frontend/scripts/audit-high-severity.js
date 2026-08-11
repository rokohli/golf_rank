const { spawnSync } = require('node:child_process')

// These findings are present on main in the Expo SDK 53 / React Native 0.79
// dependency tree. They are reviewed individually and must be removed as part
// of the next SDK upgrade; any other high or critical advisory fails CI.
const BASELINE_EXPIRES_ON = '2026-11-30'
const BASELINE_ADVISORY_IDS = new Set([
  1130588, // brace-expansion
  1130589, // brace-expansion
  1130736, // brace-expansion
  1130737, // brace-expansion
  1138114, // js-yaml
  1138115, // js-yaml
  1138813, // nanoid
  1138808, // image-size
  1138809, // image-size
])

function fail(message) {
  console.error(`Frontend dependency audit failed: ${message}`)
  process.exitCode = 1
}

if (new Date(`${BASELINE_EXPIRES_ON}T23:59:59Z`) < new Date()) {
  fail(`the reviewed advisory baseline expired on ${BASELINE_EXPIRES_ON}; upgrade Expo or renew each exception explicitly`)
  return
}

const audit = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8' })
if (audit.error) {
  fail(audit.error.message)
  return
}

let report
try {
  report = JSON.parse(audit.stdout)
} catch {
  fail('npm did not return a parseable JSON audit report')
  return
}

if (report.error) {
  fail(report.error.summary || report.error.message || 'npm audit returned an error')
  return
}

const findings = new Map()
for (const vulnerability of Object.values(report.vulnerabilities || {})) {
  for (const via of vulnerability.via || []) {
    if (typeof via !== 'object' || !['high', 'critical'].includes(via.severity)) continue
    findings.set(via.source, { name: via.name, severity: via.severity, title: via.title })
  }
}

const unapproved = [...findings.entries()].filter(([id, finding]) =>
  finding.severity === 'critical' || !BASELINE_ADVISORY_IDS.has(id),
)

if (unapproved.length > 0) {
  for (const [id, finding] of unapproved) {
    console.error(`- ${finding.severity}: ${finding.name} (advisory ${id}) — ${finding.title}`)
  }
  fail('new high or critical advisories require remediation or an explicit, time-bounded review')
  return
}

console.log(`Frontend dependency audit passed; ${findings.size} reviewed high-severity baseline advisories remain until ${BASELINE_EXPIRES_ON}.`)
