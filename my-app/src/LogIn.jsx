import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { User, Lock, Eye, EyeOff } from 'lucide-react'
import './LogIn.css'

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000'

export default function Login() {
  const navigate = useNavigate()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [identifierError, setIdentifierError] = useState(false)
  const [passwordError, setPasswordError] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Set when authFetch (AdminContext.jsx) bounced here after a 401 — an
  // expired (8h) or otherwise invalid token. Without this, landing back on
  // a bare login form after being kicked out mid-session looks like the app
  // just broke, not like the deliberate security behavior it actually is.
  const [sessionExpiredMsg, setSessionExpiredMsg] = useState('')
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('sessionExpired') === '1') {
      setSessionExpiredMsg('Your session has expired. Please log in again.')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  // Set when the account is still on the temporary password the office
  // gave it at creation (must_change_password). Holds the just-issued
  // token/user in memory only — nothing goes to localStorage until a real
  // password is set, so the change can't be skipped by closing this screen.
  // The backend enforces the same thing (verifyToken rejects everything but
  // the password change while the flag is set).
  const [forcedChange, setForcedChange] = useState(null) // { token, user }
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [changeError, setChangeError] = useState('')
  const [changing, setChanging] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()

    let hasError = false
    if (!identifier) { setIdentifierError(true); hasError = true } else setIdentifierError(false)
    if (!password)   { setPasswordError(true);   hasError = true } else setPasswordError(false)
    if (hasError) return

    try {
      setLoading(true)
      setLoginError('')

      const response = await fetch(`${API}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password })
      })

      const data = await response.json()

      if (data.success) {
        if (data.user.mustChangePassword) {
          setForcedChange({ token: data.token, user: data.user })
        } else {
          localStorage.setItem('token', data.token)
          localStorage.setItem('user', JSON.stringify(data.user))
          navigate('/dashboard')
        }
      } else {
        // Rate-limit and validation failures come back as `error`, not `message`.
        setLoginError(data.message || data.error || 'Invalid credentials.')
      }
    } catch (err) {
      console.error('Error:', err)
      setLoginError('Could not connect to server. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleForcedChange = async (e) => {
    e.preventDefault()
    setChangeError('')
    if (!newPassword || !confirmPassword) { setChangeError('Both fields are required.'); return }
    if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setChangeError('Password must be at least 8 characters, with 1 uppercase letter and 1 number.')
      return
    }
    if (newPassword !== confirmPassword) { setChangeError('Passwords do not match.'); return }
    if (newPassword === password) { setChangeError('New password must be different from your temporary password.'); return }

    try {
      setChanging(true)
      // currentPassword is the temporary password they just logged in with —
      // changing your OWN password always requires it (see users.js
      // PUT /:id/password).
      const response = await fetch(`${API}/api/users/${forcedChange.user.id}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${forcedChange.token}` },
        body: JSON.stringify({ currentPassword: password, newPassword })
      })
      const data = await response.json()
      if (response.ok && data.success) {
        localStorage.setItem('token', forcedChange.token)
        localStorage.setItem('user', JSON.stringify({ ...forcedChange.user, mustChangePassword: false }))
        navigate('/dashboard')
      } else {
        setChangeError(data.error || data.errors?.[0]?.msg || 'Failed to change password.')
      }
    } catch (err) {
      console.error('Error:', err)
      setChangeError('Could not connect to server. Please try again.')
    } finally {
      setChanging(false)
    }
  }

  const backToLogin = () => {
    setForcedChange(null)
    setPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setChangeError('')
  }

  const BrandPanel = () => (
    <div className="login-left">
      <img src="src/assets/image/logo.png" alt="logo" className="brand-logo" />
      <h1 className="system-name">eLEGIS</h1>
      <p className="brand-sub">OFFICE OF SANGGUNIANG BAYAN</p>
      <p className="brand-tagline">Legislative Management System of Balilihan, Bohol</p>
    </div>
  )

  if (forcedChange) {
    const ToggleIcon = showNewPassword ? EyeOff : Eye
    return (
      <div className="login-page">
        <BrandPanel />
        <div className="login-right">
          <form className="login-form" onSubmit={handleForcedChange}>
            <h2 className="welcome-title">Set a New Password</h2>
            <p className="welcome-sub">
              Welcome, {forcedChange.user.name}. You signed in with a temporary password — please choose your own password before continuing to the dashboard.
            </p>

            <label className="field-label">New Password</label>
            <div className="input-box">
              <Lock className="input-icon-left" size={18} />
              <input
                type={showNewPassword ? 'text' : 'password'}
                placeholder="New Password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoFocus
              />
              <ToggleIcon
                className="input-icon-right toggle-password"
                size={18}
                onClick={() => setShowNewPassword((v) => !v)}
                role="button"
                tabIndex={0}
                aria-label={showNewPassword ? 'Hide password' : 'Show password'}
              />
            </div>

            <label className="field-label">Confirm New Password</label>
            <div className="input-box">
              <Lock className="input-icon-left" size={18} />
              <input
                type={showNewPassword ? 'text' : 'password'}
                placeholder="Confirm New Password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            <p className="form-hint">At least 8 characters, with 1 uppercase letter and 1 number.</p>

            {changeError && <p className="form-error">{changeError}</p>}

            <button type="submit" className="btn" disabled={changing}>
              {changing ? 'Saving...' : 'Set New Password'}
            </button>

            <p className="register-link">
              <button type="button" className="link-btn" onClick={backToLogin} disabled={changing}>
                Back to login
              </button>
            </p>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="login-page">
      <BrandPanel />
      <div className="login-right">
        <form className="login-form" onSubmit={handleSubmit}>
          <h2 className="welcome-title">Welcome Back</h2>
          <p className="welcome-sub">Sign in to access your dashboard and manage legislative records.</p>

          {sessionExpiredMsg && (
            <p className="form-notice">{sessionExpiredMsg}</p>
          )}

          <label className="field-label">Username or Email</label>
          <div className={`input-box ${identifierError ? 'input-error' : ''}`}>
            <User className="input-icon-left" size={18} />
            <input
              type="text"
              placeholder={identifierError ? 'Username or email is required' : 'Username or Email'}
              value={identifier}
              onChange={(e) => {
                setIdentifier(e.target.value)
                if (e.target.value) setIdentifierError(false)
              }}
            />
          </div>

          <label className="field-label">Password</label>
          <div className={`input-box ${passwordError ? 'input-error' : ''}`}>
            <Lock className="input-icon-left" size={18} />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder={passwordError ? 'Password is required' : 'Password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (e.target.value) setPasswordError(false)
              }}
            />
            {showPassword ? (
              <EyeOff
                className="input-icon-right toggle-password"
                size={18}
                onClick={() => setShowPassword(false)}
                role="button"
                tabIndex={0}
                aria-label="Hide password"
              />
            ) : (
              <Eye
                className="input-icon-right toggle-password"
                size={18}
                onClick={() => setShowPassword(true)}
                role="button"
                tabIndex={0}
                aria-label="Show password"
              />
            )}
          </div>

          {loginError && <p className="form-error">{loginError}</p>}

          <button type="submit" className="btn" disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  )
}
