import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { googleApi } from '../../api/google'
import { ApiError } from '../../api/client'
import { showConfirm } from '../shared/ConfirmDialog'
import './settings.css'

interface GoogleStatus {
  connected: boolean
  sheetsId: string | null
  driveFolderId: string | null
}

export default function SettingsPage() {
  const { token, user } = useAuthStore()
  const [searchParams, setSearchParams] = useSearchParams()

  const [status, setStatus] = useState<GoogleStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // Handle OAuth callback redirect
  useEffect(() => {
    const googleParam = searchParams.get('google')
    if (googleParam === 'success') {
      setSuccessMsg('Kết nối Google thành công!')
      setSearchParams({}, { replace: true })
    } else if (googleParam === 'error') {
      const reason = searchParams.get('reason')
      setError(reason === 'no_refresh'
        ? 'Không nhận được refresh token. Vui lòng thử lại và chọn "Allow" khi Google hỏi.'
        : 'Kết nối Google thất bại. Vui lòng thử lại.')
      setSearchParams({}, { replace: true })
    }
  }, [])

  useEffect(() => {
    loadStatus()
  }, [])

  async function loadStatus() {
    try {
      const data = await googleApi.getStatus(token!)
      setStatus(data)
    } catch {
      setStatus({ connected: false, sheetsId: null, driveFolderId: null })
    } finally {
      setLoading(false)
    }
  }

  async function handleConnect() {
    setConnecting(true)
    setError('')
    try {
      const data = await googleApi.getAuthUrl(token!)
      window.location.href = data.url
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Lỗi kết nối')
      setConnecting(false)
    }
  }

  async function handleDisconnect() {
    const ok = await showConfirm({
      title: 'Ngắt kết nối Google',
      message: 'Các tính năng Sheets và Drive sẽ không hoạt động sau khi ngắt kết nối.',
      confirmLabel: 'Ngắt kết nối',
    })
    if (!ok) return
    setDisconnecting(true)
    try {
      await googleApi.disconnect(token!)
      setStatus({ connected: false, sheetsId: null, driveFolderId: null })
      setSuccessMsg('Đã ngắt kết nối Google.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Lỗi')
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className="settings-page">
      <div className="page-header">
        <div>
          <h2 className="page-title">Cài đặt</h2>
          <p className="page-subtitle">Tài khoản và tích hợp</p>
        </div>
      </div>

      {/* User info */}
      <div className="settings-section">
        <h3 className="settings-section-title">Tài khoản</h3>
        <div className="settings-card">
          <div className="user-info-row">
            <div className="user-avatar-lg">
              {user?.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
            </div>
            <div>
              <div className="user-name-lg">{user?.name}</div>
              <div className="user-email-lg">{user?.email}</div>
              <div className="user-role-badge">{user?.role?.replace('_', ' ')}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Google integration */}
      <div className="settings-section">
        <h3 className="settings-section-title">Google Sheets & Drive</h3>
        <p className="settings-section-desc">
          Tính năng tùy chọn — đồng bộ shotlist với Google Sheets và lưu storyboard trên Google Drive của bạn.
        </p>

        {error && <div className="settings-error">{error}</div>}
        {successMsg && <div className="settings-success">{successMsg}</div>}

        <div className="settings-card">
          {loading ? (
            <div className="settings-loading"><div className="spinner" /></div>
          ) : !status?.connected ? (
            <div className="google-connect">
              <div className="google-icon">
                <svg width="24" height="24" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
              </div>
              <div>
                <div className="google-connect-title">Chưa kết nối Google</div>
                <div className="google-connect-desc">Kết nối để đồng bộ shotlist và lưu storyboard</div>
              </div>
              <button
                className="btn-google-connect"
                onClick={handleConnect}
                disabled={connecting}
              >
                {connecting ? 'Đang chuyển hướng…' : 'Kết nối Google'}
              </button>
            </div>
          ) : (
            <div>
              <div className="google-connected-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div className="google-connected-dot" />
                  <span style={{ fontSize: '0.875rem', color: 'var(--color-text)' }}>Đã kết nối Google</span>
                </div>
                <button
                  className="btn-disconnect"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                >
                  {disconnecting ? 'Đang ngắt…' : 'Ngắt kết nối'}
                </button>
              </div>

              {/* Sheets setup */}
              <div className="sheets-setup">
                <div className="sheets-setup-header">
                  <div>
                    <div className="sheets-setup-title">Google Sheets Sync</div>
                    <div className="sheets-setup-desc">
                      Để tạo Google Sheet cho một script, vào trang Shotlist và nhấn nút <strong>+ Google Sheet</strong>.
                    </div>
                  </div>
                </div>
              </div>

              {/* Drive info */}
              <div className="drive-info">
                <div className="drive-info-title">Google Drive (Storyboard)</div>
                <div className="drive-info-desc">
                  Khi upload storyboard cho một shot, ảnh sẽ được lưu vào Drive của bạn. Folder sẽ tự tạo lần đầu upload.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
