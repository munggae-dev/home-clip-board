// Read before client-side navigation changes the URL from home to settings.
const launchParam = window.location.pathname === '/'
  ? new URLSearchParams(window.location.search).get('launcher_version')
  : null

export const launcherVersionAtStart = launchParam && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/.test(launchParam)
  ? launchParam
  : null
