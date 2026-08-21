import { useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { PermissionProvider } from './auth/PermissionContext.jsx'
import { ADMIN_ENTRY_PERMISSIONS, PERMISSIONS } from './auth/permissionCodes.js'
import { TransitionProvider } from './transition/TransitionContext.jsx'
import ProtectedRoute from './components/ProtectedRoute'
import PermissionRoute, { AdminIndexRedirect } from './components/PermissionRoute.jsx'
import Splash from './components/splash/Splash.jsx'
import LoginPage from './pages/LoginPage'
import TwoFactorPage from './pages/TwoFactorPage'
import RegisterPage from './pages/RegisterPage'
import ConfirmEmailPage from './pages/ConfirmEmailPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import ActivateAccountPage from './pages/ActivateAccountPage'
import MapPage from './pages/MapPage'
import AdminLayout from './components/admin/AdminLayout.jsx'
import AdminPage from './pages/AdminPage'
import RolesPage from './pages/admin/RolesPage.jsx'
import PermissionsPage from './pages/admin/PermissionsPage.jsx'
import ActivityPage from './pages/admin/ActivityPage.jsx'
import AccessDeniedPage from './pages/AccessDeniedPage.jsx'

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
          {/* Yetkiler AuthProvider'ın İÇİNDE yüklenir: kaynağı token'dır ve
              oturum bittiğinde küme onunla birlikte düşer. */}
          <PermissionProvider>
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
                <Route path="/activate-account" element={<ActivateAccountPage />} />
                {/* Harita erişimi `map.view` ile açılır. Yetkisi olmayan
                    kimliği doğrulanmış kullanıcı /login'e DEĞİL, yetkisizlik
                    ekranına düşer — oturumunda bir sorun yok. */}
                <Route
                  path="/map"
                  element={
                    <PermissionRoute anyOf={[PERMISSIONS.MAP_VIEW]}>
                      <MapPage />
                    </PermissionRoute>
                  }
                />

                {/* Hiçbir bölümü açamayan ama oturumu geçerli kullanıcının
                    ineceği yer. Kendi başına da adreslenebilir olmalı ki
                    yönlendirme yapan koruyucular bir yere işaret edebilsin. */}
                <Route
                  path="/erisim-yok"
                  element={
                    <ProtectedRoute>
                      <AccessDeniedPage />
                    </ProtectedRoute>
                  }
                />
                {/* Panele giriş, GÖRÜNTÜLEYEBİLECEĞİ en az bir bölüm olmasına
                    bağlıdır — rol ADINA değil. Koruyucu bir gezinme kolaylığıdır;
                    gerçek zorlama backend'in MFA + yetki politikalarıdır (403).

                    İç içe: kabuk (kenar çubuğu, başlık, çekmece) BİR kez mount
                    olur ve alt rotalar yalnızca içeriği değiştirir. Düz rotalar
                    her gezinmede paneli baştan kurar ve her sayfayı kendi kenar
                    çubuğunu üretmeye davet ederdi. */}
                <Route
                  path="/admin"
                  element={
                    <PermissionRoute anyOf={ADMIN_ENTRY_PERMISSIONS}>
                      <AdminLayout />
                    </PermissionRoute>
                  }
                >
                  {/* Kök, aktörün gerçekten açabileceği İLK bölüme gider. Sabit
                      bir /admin/users, yalnızca roles.view taşıyan bir yöneticiyi
                      paneli her açtığında yetkisizlik ekranına düşürürdü. */}
                  <Route index element={<AdminIndexRedirect />} />
                  <Route
                    path="users"
                    element={
                      <PermissionRoute anyOf={[PERMISSIONS.USERS_VIEW]}>
                        <AdminPage />
                      </PermissionRoute>
                    }
                  />
                  <Route
                    path="roles"
                    element={
                      <PermissionRoute anyOf={[PERMISSIONS.ROLES_VIEW]}>
                        <RolesPage />
                      </PermissionRoute>
                    }
                  />
                  <Route
                    path="permissions"
                    element={
                      <PermissionRoute anyOf={[PERMISSIONS.PERMISSIONS_VIEW]}>
                        <PermissionsPage />
                      </PermissionRoute>
                    }
                  />
                  {/* Aktivite geçmişi kendi yetkisiyle korunur: yönetim
                      paneline başka bir yetkiyle giren biri bu rotayı
                      açamaz. */}
                  <Route
                    path="activity"
                    element={
                      <PermissionRoute anyOf={[PERMISSIONS.ACTIVITY_VIEW]}>
                        <ActivityPage />
                      </PermissionRoute>
                    }
                  />
                </Route>
                <Route path="/" element={<Navigate to="/map" replace />} />
                <Route path="*" element={<Navigate to="/login" replace />} />
              </Routes>
            </TransitionProvider>
          </PermissionProvider>
        </AuthProvider>
      )}
    </BrowserRouter>
  )
}

export default App
