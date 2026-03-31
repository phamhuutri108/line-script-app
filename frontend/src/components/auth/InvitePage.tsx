import { useState, useEffect, type FormEvent } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { api } from '../../api/client'
import { ApiError } from '../../api/client'
import { useAuthStore } from '../../stores/authStore'
import type { User } from '../../api/auth'
import './auth.css'

interface InviteInfo {
  valid: boolean
  projectId: string
  projectName: string
  email: string | null
  expiresAt: number
}

interface AcceptResponse {
  token: string
  user: User
  projectId: string
}

export default function InvitePage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { setAuth } = useAuthStore()

  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) return
    api.get<InviteInfo>(`/invite/${token}`)
      .then((data) => {
        setInvite(data)
        if (data.email) setEmail(data.email)
      })
      .catch((err) => {
        setLoadError(err instanceof ApiError ? err.message : 'Invalid invite link')
      })
      .finally(() => setLoading(false))
  }, [token])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitError('')
    if (password.length < 8) {
      setSubmitError('Mật khẩu phải có ít nhất 8 ký tự.')
      return
    }
    setSubmitting(true)
    try {
      const res = await api.post<AcceptResponse>(`/invite/${token}/accept`, { email, password, name })
      setAuth(res.token, res.user)
      navigate(`/projects/${res.projectId}`, { replace: true })
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Lỗi mạng. Vui lòng thử lại.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">
            <h1>Script Lining</h1>
          </div>
          <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--color-text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 1rem' }} />
            Đang xác thực lời mời…
          </div>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">
            <h1>Script Lining</h1>
          </div>
          <div className="auth-error" style={{ marginBottom: '1rem' }}>{loadError}</div>
          <Link to="/login" className="btn-primary" style={{ display: 'block', textAlign: 'center' }}>
            Về trang đăng nhập
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <h1>Script Lining</h1>
          <p>Bạn được mời tham gia</p>
        </div>

        {invite && (
          <div style={{
            background: 'rgba(108,99,255,0.1)',
            border: '1px solid rgba(108,99,255,0.3)',
            borderRadius: '8px',
            padding: '0.75rem 1rem',
            marginBottom: '1.25rem',
            fontSize: '0.875rem',
            color: 'var(--color-text)',
          }}>
            Dự án: <strong>{invite.projectName}</strong>
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          {submitError && <div className="auth-error">{submitError}</div>}

          <div className="form-group">
            <label htmlFor="name">Tên của bạn</label>
            <input
              id="name"
              type="text"
              placeholder="Nguyễn Văn A"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              readOnly={!!invite?.email}
              style={invite?.email ? { opacity: 0.6 } : {}}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Mật khẩu</label>
            <input
              id="password"
              type="password"
              placeholder="Tối thiểu 8 ký tự"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>

          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Đang tạo tài khoản…' : 'Tạo tài khoản & vào dự án'}
          </button>

          <p className="auth-footer">
            Đã có tài khoản?{' '}
            <Link to="/login">Đăng nhập</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
