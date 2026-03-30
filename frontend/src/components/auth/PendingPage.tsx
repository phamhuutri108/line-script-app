import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import './auth.css'

export default function PendingPage() {
  const navigate = useNavigate()
  const clearAuth = useAuthStore((s) => s.clearAuth)

  function handleLogout() {
    clearAuth()
    navigate('/login', { replace: true })
  }

  return (
    <div className="auth-page">
      <div className="auth-card pending-card">
        <div className="pending-icon">⏳</div>
        <h2>Awaiting approval</h2>
        <p>
          Your account has been created and is pending admin approval.
          <br />
          You will be able to sign in once your account is activated.
        </p>
        <button className="btn-ghost" onClick={handleLogout}>
          Back to sign in
        </button>
      </div>
    </div>
  )
}
