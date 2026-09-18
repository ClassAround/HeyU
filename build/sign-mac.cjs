const { signAsync } = require('@electron/osx-sign')

// Test distributions have no Developer ID certificate. Seal every nested
// executable and the final app bundle instead of leaving Electron's original,
// invalidated signature behind. This does not replace Apple notarization.
module.exports = async function signMac(options) {
  await signAsync({
    ...options,
    identity: '-',
    identityValidation: false,
    preAutoEntitlements: false,
    // osx-sign enables --strict by default; boolean true becomes --strict=true.
    strictVerify: undefined,
    optionsForFile: () => ({ hardenedRuntime: false })
  })
}
