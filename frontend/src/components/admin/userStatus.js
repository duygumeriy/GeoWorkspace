export function mfaLabel(user) {
  if (user.role === 'Admin') {
    return user.twoFactorEnabled ? 'Etkin / Zorunlu' : 'Kurulum Bekliyor'
  }
  return user.twoFactorEnabled ? 'Etkin' : 'Kapalı'
}
