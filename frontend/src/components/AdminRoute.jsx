import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

/**
 * Route guard for Admin-only screens (the actual admin UI arrives in AUTH-6).
 *
 * This is a navigation convenience, NOT a security boundary: anyone can edit
 * client state. The real enforcement is the `AdminOnly` policy on the backend,
 * which answers 403 regardless of what the browser believes. The guard exists
 * so a non-admin never lands on a screen that would only show them errors.
 */
export default function AdminRoute({ children }) {
  const { isAuthenticated, isAdmin, profileLoading, user } = useAuth()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  // The role lives in the profile, which is fetched asynchronously — deciding
  // before it arrives would bounce every admin on a fresh page load.
  if (profileLoading || !user) {
    return null
  }

  if (!isAdmin) {
    return <Navigate to="/map" replace />
  }

  return children
}
