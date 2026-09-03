import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthShell from './AuthShell.jsx'
import TextField from '../components/ui/TextField.jsx'
import Button from '../components/ui/Button.jsx'
import IconButton from '../components/ui/IconButton.jsx'
import { register as registerRequest, readAccountError } from '../services/api'
import {
  UserIcon,
  LockIcon,
  EyeIcon,
  EyeOffIcon,
  AlertIcon,
  CheckIcon,
  ArrowRightIcon,
} from '../components/ui/icons/index.js'

/**
 * Account creation. The backend is the source of truth for every rule here —
 * the client-side checks below only save a round-trip, they are never the
 * thing that decides whether a password or address is acceptable.
 */
export default function RegisterPage() {
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [errorKey, setErrorKey] = useState(0)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState('')
  const navigate = useNavigate()

  const setField = (name) => (event) => setForm((prev) => ({ ...prev, [name]: event.target.value }))

  const showError = (message) => {
    setError(message)
    setErrorKey((k) => k + 1)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')

    if (form.password !== form.confirmPassword) {
      showError('Şifreler eşleşmiyor.')
      return
    }

    setLoading(true)

    try {
      const res = await registerRequest(form)

      if (!res.ok) {
        throw new Error(await readAccountError(res, 'Kayıt tamamlanamadı.'))
      }

      const data = await res.json()
      // No auto-login: the account cannot sign in until the address is verified.
      setSuccess(data.message)
    } catch (err) {
      showError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <AuthShell eyebrow="Son bir adım" title="Hesabınız oluşturuldu" showLanguageSelector={false}>
        <div className="auth-success" role="status">
          <CheckIcon size={16} />
          <span>{success}</span>
        </div>
        <p className="auth-note" style={{ marginTop: '1rem' }}>
          Doğrulama e-postası gelmediyse giriş ekranından yeniden gönderebilirsiniz.
        </p>
        <Button className="login-submit" onClick={() => navigate('/login')}>
          Giriş ekranına dön
        </Button>
      </AuthShell>
    )
  }

  /* Dil hapı kapalı: hiçbir şeyi değiştirmeyen bir denetim, kayıt olan kişiye
     var olmayan bir seçenek vaat ediyordu. Kabuğun VARSAYILANI değişmez —
     devre dışı bırakma bu ekrana özeldir ve iki dalda da geçerlidir. */
  return (
    <AuthShell eyebrow="Aramıza katılın" title="Yeni hesap oluşturun" showLanguageSelector={false}>
      <form onSubmit={handleSubmit} noValidate>
        <TextField
          id="register-username"
          label="Kullanıcı adı"
          icon={<UserIcon size={19} />}
          type="text"
          value={form.username}
          onChange={setField('username')}
          autoComplete="username"
          placeholder="Kullanıcı adınızı belirleyin"
          autoFocus
          required
        />

        <TextField
          id="register-email"
          label="E-posta"
          icon={<UserIcon size={19} />}
          type="email"
          value={form.email}
          onChange={setField('email')}
          autoComplete="email"
          placeholder="ornek@eposta.com"
          required
        />

        <TextField
          id="register-password"
          label="Şifre"
          icon={<LockIcon size={19} />}
          type={showPassword ? 'text' : 'password'}
          value={form.password}
          onChange={setField('password')}
          autoComplete="new-password"
          placeholder="En az 8 karakter"
          required
          trailing={
            <IconButton
              label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
              onClick={() => setShowPassword((v) => !v)}
              className="login-eye-toggle"
            >
              {showPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
            </IconButton>
          }
        />

        <TextField
          id="register-confirm"
          label="Şifre tekrar"
          icon={<LockIcon size={19} />}
          type={showPassword ? 'text' : 'password'}
          value={form.confirmPassword}
          onChange={setField('confirmPassword')}
          autoComplete="new-password"
          placeholder="Şifrenizi tekrar girin"
          required
        />

        <p className="auth-note">
          Şifreniz en az 8 karakter olmalı; büyük harf, küçük harf ve rakam içermelidir.
        </p>

        {error && (
          <div key={errorKey} className="login-error" role="alert">
            <AlertIcon size={15} />
            <span>{error}</span>
          </div>
        )}

        <Button type="submit" loading={loading} className="login-submit">
          {loading ? 'Hesap oluşturuluyor' : 'Kayıt Ol'}
          {!loading && (
            <span className="login-submit-arrow" aria-hidden="true">
              <ArrowRightIcon size={18} />
            </span>
          )}
        </Button>
      </form>

      <p className="auth-footer">
        Zaten hesabınız var mı?{' '}
        <Link className="auth-link" to="/login">
          Giriş yapın
        </Link>
      </p>
    </AuthShell>
  )
}
