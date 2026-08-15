import { useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { TransitionProvider } from './transition/TransitionContext.jsx'
import ProtectedRoute from './components/ProtectedRoute'
import AdminRoute from './components/AdminRoute'
import Splash from './components/splash/Splash.jsx'
import LoginPage from './pages/LoginPage'
import TwoFactorPage from './pages/TwoFactorPage'
import RegisterPage from './pages/RegisterPage'
import ConfirmEmailPage from './pages/ConfirmEmailPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import MapPage from './pages/MapPage'
import AdminPage from './pages/AdminPage'

function App() {
  // Splash lives above the router entirely, gating what mounts underneath it
  // rather than being mounted *by* a page. It flips exactly once per app
  // load and is structurally incapable of being re-triggered by login or by
  // any other client-side navigation.
  const [booted, setBooted] = useState(false)

  return (
    <BrowserRouter>
      {!booted ? (
        <Splash onComplete={() => setBooted(true)} />
      ) : (
        <AuthProvider>
          <TransitionProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              {/* Second login step. Guards itself: without a pending challenge
                  in AuthContext it redirects back to /login. */}
              <Route path="/login/2fa" element={<TwoFactorPage />} />
              <Route path="/register" element={<RegisterPage />} />
              {/* Reached from the links in the verification / reset e-mails. */}
              <Route path="/confirm-email" element={<ConfirmEmailPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route
                path="/map"
                element={
                  <ProtectedRoute>
                    <MapPage />
                  </ProtectedRoute>
                }
              />
              {/* Admin-only. The guard is navigation convenience; the real
                  enforcement is the backend's AdminOnly policy (403). */}
              <Route
                path="/admin"
                element={<Navigate to="/admin/users" replace />}
              />
              <Route
                path="/admin/users"
                element={
                  <AdminRoute>
                    <AdminPage />
                  </AdminRoute>
                }
              />
              <Route path="/" element={<Navigate to="/map" replace />} />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </TransitionProvider>
        </AuthProvider>
      )}
    </BrowserRouter>
  )
}

export default App
