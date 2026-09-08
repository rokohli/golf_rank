const { withDangerousMod } = require('@expo/config-plugins')
const fs = require('fs')
const path = require('path')

// Very new Apple clang (Xcode 26+) has a consteval-evaluation regression that
// breaks fmt's FMT_STRING macro -- fmtlib's own compiler-support table in
// fmt/include/fmt/base.h doesn't yet know about it, so it wrongly assumes
// consteval is safe on this compiler.
//
// A -D preprocessor flag can't override this: base.h unconditionally does
// `#define FMT_USE_CONSTEVAL ...` / `#define FMT_CONSTEVAL ...` with no
// `#ifndef` guard, so any command-line predefinition just gets silently
// clobbered by the header's own #define. The only working fix is patching
// the vendored header directly, extending fmt's *existing* "consteval is
// broken on this Apple clang" fallback (already there for clang < 14) to
// cover all Apple clang versions, not just old ones.
//
// This runs as a Podfile post_install hook so it applies after every
// `pod install`, in any environment (local machine or EAS Build's cloud
// workers) -- both do their own fresh prebuild from this project's config
// plugins, so a hand-edit to a checked-out ios/ directory would not survive
// or reach EAS at all.
const PATCH_MARKER = 'golf_rank fmt consteval fix'

const POST_INSTALL_SNIPPET = `
    # ${PATCH_MARKER}
    fmt_pod_dir = installer.sandbox.pod_dir('fmt')
    fmt_header = fmt_pod_dir ? File.join(fmt_pod_dir.to_s, 'include', 'fmt', 'base.h') : nil
    if fmt_header && File.exist?(fmt_header)
      original = File.read(fmt_header)
      patched = original.sub(
        /#elif defined\\(__apple_build_version__\\) && __apple_build_version__ < 14000029L/,
        '#elif defined(__apple_build_version__)'
      )
      File.write(fmt_header, patched) if patched != original
    end
`

module.exports = function withFmtConstevalFix(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile')
      let contents = fs.readFileSync(podfilePath, 'utf8')
      if (!contents.includes(PATCH_MARKER)) {
        contents = contents.replace(
          'post_install do |installer|',
          `post_install do |installer|\n${POST_INSTALL_SNIPPET}`,
        )
        fs.writeFileSync(podfilePath, contents)
      }
      return config
    },
  ])
}
