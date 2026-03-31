import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import type { Shot } from '../../api/shots'
import './share.css'

interface ShareData {
  scriptName: string
  shots: Shot[]
}

export default function SharePage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<ShareData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    api.get<ShareData>(`/share/${token}`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Không tải được'))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return (
    <div className="share-page">
      <div className="share-loading">
        <div className="spinner" />
        Đang tải shotlist…
      </div>
    </div>
  )

  if (error) return (
    <div className="share-page">
      <div className="share-error">
        <p>{error}</p>
        <Link to="/login">Về trang đăng nhập</Link>
      </div>
    </div>
  )

  if (!data) return null

  return (
    <div className="share-page">
      <header className="share-header">
        <div className="share-header-inner">
          <div>
            <h1 className="share-title">{data.scriptName}</h1>
            <p className="share-subtitle">{data.shots.length} shot · Chia sẻ công khai</p>
          </div>
          <div className="share-badge">Script Lining</div>
        </div>
      </header>

      <main className="share-main">
        {data.shots.length === 0 ? (
          <div className="share-empty">Chưa có shot nào trong shotlist này.</div>
        ) : (
          <div className="share-table-wrap">
            <table className="share-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Cảnh</th>
                  <th>Địa điểm</th>
                  <th>INT/EXT</th>
                  <th>Ngày/Đêm</th>
                  <th>Mô tả</th>
                  <th>Góc máy</th>
                  <th>Kích thước</th>
                  <th>Di chuyển</th>
                  <th>Ống kính</th>
                  <th>Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {data.shots.map((shot) => (
                  <tr key={shot.id}>
                    <td className="td-num">{shot.shot_number}</td>
                    <td>{shot.scene_number ?? '—'}</td>
                    <td>{shot.location ?? '—'}</td>
                    <td>{shot.int_ext ?? '—'}</td>
                    <td>{shot.day_night ?? '—'}</td>
                    <td className="td-desc">{shot.description ?? '—'}</td>
                    <td>{shot.angle ?? '—'}</td>
                    <td>{shot.shot_size ?? '—'}</td>
                    <td>{shot.movement ?? '—'}</td>
                    <td>{shot.lens ?? '—'}</td>
                    <td className="td-desc">{shot.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
