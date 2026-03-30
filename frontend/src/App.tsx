import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import LoginPage from './components/auth/LoginPage'
import RegisterPage from './components/auth/RegisterPage'
import PendingPage from './components/auth/PendingPage'
import ProtectedRoute from './components/auth/ProtectedRoute'

// Placeholder — replaced in Step 6
function DashboardPage() {
  const { user, clearAuth } = useAuthStore()
  return (
    <div style={{ padding: '2rem', color: 'white' }}>
      <p>Welcome, <strong>{user?.name}</strong> ({user?.role})</p>
      <button
        onClick={clearAuth}
        style={{ marginTop: '1rem', padding: '0.5rem 1rem', cursor: 'pointer' }}
      >
        Sign out
      </button>
    </div>
  )
}

export default function App() {
  const { token, user } = useAuthStore()
  const isAuth = !!token && !!user

  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes — redirect to dashboard if already logged in */}
        <Route
          path="/login"
          element={isAuth && user?.role !== 'pending' ? <Navigate to="/dashboard" replace /> : <LoginPage />}
        />
        <Route
          path="/register"
          element={isAuth ? <Navigate to="/dashboard" replace /> : <RegisterPage />}
        />
        <Route path="/pending" element={<PendingPage />} />

        {/* Protected routes */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to={isAuth ? '/dashboard' : '/login'} replace />} />
      </Routes>
    </BrowserRouter>
  )
}
