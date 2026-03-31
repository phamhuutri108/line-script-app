import { Link } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import './home.css'

export default function HomePage() {
  const { token, user } = useAuthStore()
  const isAuth = !!token && !!user && user.role !== 'pending'

  return (
    <div className="home-page">
      <div className="home-content">
        <div className="home-logo">
          <img src="/favicon.png" alt="Script Lining" className="home-icon" />
          <h1>Script Lining</h1>
          <p>Line Script and auto Shotlist tool.</p>
        </div>

        <div className="home-actions">
          {isAuth ? (
            <Link to="/dashboard" className="home-btn-primary">Vào app</Link>
          ) : (
            <>
              <Link to="/login" className="home-btn-primary">Đăng nhập</Link>
              <Link to="/register" className="home-btn-secondary">Đăng ký</Link>
            </>
          )}
        </div>

        <p className="home-note">Nếu bạn đã vào được đây thì bạn rất đáng quý với tui 🙂‍↔️</p>
      </div>
    </div>
  )
}
