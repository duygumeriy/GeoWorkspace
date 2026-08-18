import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

/**
 * Route guard for the admin panel.
 *
 * This is a navigation convenience, NOT a security boundary: anyone can edit
 * client state. The real enforcement is the backend's MFA + permission
 * policies, which answer 403 regardless of what the browser believes. The
 * guard exists so a non-admin never lands on a screen that would only show
 * them errors.
 *
 * Reads `canAccessAdminPanel` rather than `isAdmin`: since Phase 4 the
 * canonical `Administrator` role is a real administrator the backend accepts,
 * and gating on the legacy `Admin` name alone would lock it out of a panel it
 * is authorised to use. `isAdmin` keeps its narrower meaning for the map's
 * drawing-ownership rule.
 */
export default function AdminRoute({ children }) {
  const { isAuthenticated, canAccessAdminPanel, profileLoading, user } = useAuth()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  // The role lives in the profile, which is fetched asynchronously — deciding
  // before it arrives would bounce every admin on a fresh page load.
  if (profileLoading || !user) {
    return null
  }

  if (!canAccessAdminPanel) {
    return <Navigate to="/map" replace />
  }

  return children
}
