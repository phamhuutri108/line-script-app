import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import LoginPage from './components/auth/LoginPage'
import RegisterPage from './components/auth/RegisterPage'
import PendingPage from './components/auth/PendingPage'
import ProtectedRoute from './components/auth/ProtectedRoute'
import AppLayout from './components/layout/AppLayout'
import DashboardPage from './components/project/DashboardPage'
import ProjectDetailPage from './components/project/ProjectDetailPage'
import ViewerPage from './components/viewer/ViewerPage'
import AdminPage from './components/admin/AdminPage'
import InvitePage from './components/auth/InvitePage'
import SharePage from './components/share/SharePage'

export default function App() {
  const { token, user } = useAuthStore()
  const isAuth = !!token && !!user && user.role !== 'pending'

  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={isAuth ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
        <Route path="/register" element={isAuth ? <Navigate to="/dashboard" replace /> : <RegisterPage />} />
        <Route path="/pending" element={<PendingPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/share/:token" element={<SharePage />} />

        {/* Viewer — fullscreen, no AppLayout */}
        <Route
          path="/projects/:id/scripts/:scriptId"
          element={<ProtectedRoute><ViewerPage /></ProtectedRoute>}
        />

        {/* Protected — inside AppLayout */}
        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/admin" element={<ProtectedRoute adminOnly><AdminPage /></ProtectedRoute>} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to={isAuth ? '/dashboard' : '/login'} replace />} />
      </Routes>
    </BrowserRouter>
  )
}
