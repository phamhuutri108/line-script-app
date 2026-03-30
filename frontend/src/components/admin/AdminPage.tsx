import { useState, useEffect } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { usersApi } from '../../api/users'
import { ApiError } from '../../api/client'
import type { User } from '../../api/auth'
import './admin.css'

type Tab = 'pending' | 'all'

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  owner: 'Trưởng nhóm',
  member: 'Thành viên',
  pending: 'Chờ duyệt',
}

const ROLE_CLASS: Record<string, string> = {
  super_admin: 'badge-admin',
  owner: 'badge-owner',
  member: 'badge-member',
  pending: 'badge-pending',
}

export default function AdminPage() {
  const { token } = useAuthStore()
  const [tab, setTab] = useState<Tab>('pending')
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    loadUsers()
  }, [tab])

  async function loadUsers() {
    setLoading(true)
    setError('')
    try {
      const data = await usersApi.list(token!, tab === 'pending' ? 'pending' : undefined)
      setUsers(data.users)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được danh sách')
    } finally {
      setLoading(false)
    }
  }

  async function handleApprove(userId: string) {
    setActionId(userId)
    try {
      await usersApi.approve(token!, userId)
      setUsers((prev) => prev.filter((u) => u.id !== userId))
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Lỗi')
    } finally {
      setActionId(null)
    }
  }

  async function handleReject(userId: string) {
    if (!confirm('Xóa tài khoản này?')) return
    setActionId(userId)
    try {
      await usersApi.delete(token!, userId)
      setUsers((prev) => prev.filter((u) => u.id !== userId))
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Lỗi')
    } finally {
      setActionId(null)
    }
  }

  async function handleRoleChange(userId: string, newRole: 'owner' | 'member') {
    setActionId(userId)
    try {
      const res = await usersApi.changeRole(token!, userId, newRole)
      setUsers((prev) => prev.map((u) => u.id === userId ? res.user : u))
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Lỗi')
    } finally {
      setActionId(null)
    }
  }

  const pendingCount = tab === 'all' ? users.filter((u) => u.role === 'pending').length : users.length

  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <h2 className="page-title">Quản trị</h2>
          <p className="page-subtitle">Quản lý tài khoản người dùng</p>
        </div>
      </div>

      {/* Stats */}
      <div className="admin-stats">
        <div className="stat-card">
          <div className="stat-value">{users.length}</div>
          <div className="stat-label">{tab === 'pending' ? 'Chờ duyệt' : 'Tổng users'}</div>
        </div>
        {tab === 'all' && (
          <>
            <div className="stat-card">
              <div className="stat-value">{users.filter((u) => u.role === 'owner').length}</div>
              <div className="stat-label">Trưởng nhóm</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{users.filter((u) => u.role === 'member').length}</div>
              <div className="stat-label">Thành viên</div>
            </div>
            {pendingCount > 0 && (
              <div className="stat-card stat-card--warning">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Chờ duyệt</div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Tabs */}
      <div className="admin-tabs">
        <button
          className={`admin-tab${tab === 'pending' ? ' active' : ''}`}
          onClick={() => setTab('pending')}
        >
          Chờ duyệt
          {tab === 'all' && pendingCount > 0 && (
            <span className="tab-badge">{pendingCount}</span>
          )}
        </button>
        <button
          className={`admin-tab${tab === 'all' ? ' active' : ''}`}
          onClick={() => setTab('all')}
        >
          Tất cả
        </button>
      </div>

      {/* Content */}
      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="admin-loading">
          <div className="spinner" />
        </div>
      ) : users.length === 0 ? (
        <div className="admin-empty">
          {tab === 'pending' ? 'Không có tài khoản nào chờ duyệt' : 'Không có user nào'}
        </div>
      ) : (
        <div className="users-table-wrap">
          <table className="users-table">
            <thead>
              <tr>
                <th>Tên</th>
                <th>Email</th>
                <th>Role</th>
                <th>Ngày tạo</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  busy={actionId === u.id}
                  onApprove={() => handleApprove(u.id)}
                  onReject={() => handleReject(u.id)}
                  onRoleChange={(role) => handleRoleChange(u.id, role)}
                  showActions={tab === 'all'}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

interface RowProps {
  user: User
  busy: boolean
  showActions: boolean
  onApprove: () => void
  onReject: () => void
  onRoleChange: (role: 'owner' | 'member') => void
}

function UserRow({ user, busy, showActions, onApprove, onReject, onRoleChange }: RowProps) {
  const initials = user.name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <tr className={busy ? 'row-busy' : ''}>
      <td>
        <div className="user-cell">
          <div className="user-avatar-sm">{initials}</div>
          <span>{user.name}</span>
        </div>
      </td>
      <td className="td-email">{user.email}</td>
      <td>
        <span className={`role-badge ${ROLE_CLASS[user.role] ?? ''}`}>
          {ROLE_LABEL[user.role] ?? user.role}
        </span>
      </td>
      <td className="td-date">
        {typeof (user as unknown as { created_at: number }).created_at === 'number'
          ? new Date((user as unknown as { created_at: number }).created_at * 1000).toLocaleDateString('vi-VN')
          : '—'}
      </td>
      <td>
        {user.role === 'pending' ? (
          <div className="action-row">
            <button className="btn-approve" onClick={onApprove} disabled={busy}>
              Duyệt
            </button>
            <button className="btn-reject" onClick={onReject} disabled={busy}>
              Từ chối
            </button>
          </div>
        ) : showActions && user.role !== 'super_admin' ? (
          <div className="action-row">
            {user.role === 'member' ? (
              <button className="btn-role" onClick={() => onRoleChange('owner')} disabled={busy}>
                → Trưởng nhóm
              </button>
            ) : (
              <button className="btn-role" onClick={() => onRoleChange('member')} disabled={busy}>
                → Thành viên
              </button>
            )}
            <button className="btn-reject" onClick={onReject} disabled={busy}>
              Xóa
            </button>
          </div>
        ) : null}
      </td>
    </tr>
  )
}
