import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'

// Placeholder pages — will be replaced in upcoming steps
function LoginPage() {
  return <div style={{ padding: '2rem', color: 'white' }}>Login — Coming in Step 4</div>
}
function RegisterPage() {
  return <div style={{ padding: '2rem', color: 'white' }}>Register — Coming in Step 4</div>
}
function PendingPage() {
  return <div style={{ padding: '2rem', color: 'white' }}>Pending approval — Coming in Step 4</div>
}
function DashboardPage() {
  return <div style={{ padding: '2rem', color: 'white' }}>Dashboard — Coming in Step 6</div>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/pending" element={<PendingPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
