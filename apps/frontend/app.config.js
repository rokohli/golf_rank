const developmentProfiles = new Set(['development', 'development-simulator'])

module.exports = ({ config }) => {
  const profile = process.env.EAS_BUILD_PROFILE
  const isLocalDevelopment = profile === undefined || developmentProfiles.has(profile)

  if (!isLocalDevelopment) return config

  return {
    ...config,
    ios: {
      ...config.ios,
      bundleIdentifier: 'com.rokohli.golfrank.dev',
      // Dev Metro is served over HTTP. Tailscale (100.x) is not RFC1918, so
      // NSAllowsLocalNetworking alone is not enough — allow cleartext in dev builds only.
      infoPlist: {
        ...config.ios?.infoPlist,
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: true,
          NSAllowsLocalNetworking: true,
        },
      },
    },
  }
}
