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
    },
  }
}
