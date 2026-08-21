import { useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import AuthShell from './AuthShell.jsx'
import TextField from '../components/ui/TextField.jsx'
import Button from '../components/ui/Button.jsx'
import IconButton from '../components/ui/IconButton.jsx'
import { activateAccount } from '../services/api.js'
import { AlertIcon, ArrowRightIcon, CheckIcon, EyeIcon, EyeOffIcon, LockIcon } from '../components/ui/icons/index.js'

const INVALID_INVITATION = 'Bu davet bağlantısı geçersiz veya süresi dolmuş.'

function InvitationFailure({ missing = false }) {
  return <AuthShell eyebrow="Hesap daveti" title="Davet bağlantısı geçersiz">
    <div className="auth-status"><span className="auth-status-icon auth-status-icon--error"><AlertIcon size={26} /></span><p className="auth-status-text" role="alert">{missing ? 'Bu davet bağlantısı geçersiz veya eksik.' : INVALID_INVITATION}</p></div>
    {!missing && <p className="auth-note">Yeni bir davet için sistem yöneticinizle iletişime geçin.</p>}
    <p className="auth-footer"><Link className="auth-link" to="/login">Giriş ekranına dön</Link></p>
  </AuthShell>
}

export default function ActivateAccountPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const submittingRef = useRef(false)
  const rawUserId = searchParams.get('userId')
  const userId = Number(rawUserId)
  const token = searchParams.get('token') ?? ''
  const validLink = rawUserId !== null && Number.isInteger(userId) && userId > 0 && token.length > 0
  const [form, setForm] = useState({ password: '', confirmPassword: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [success, setSuccess] = useState(false)

  const setField = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }))
  const submit = async (event) => {
    event.preventDefault()
    if (submittingRef.current) return
    setError('')
    if (!form.password || !form.confirmPassword) { setError('Şifre alanları zorunludur.'); return }
    if (form.password !== form.confirmPassword) { setError('Şifreler eşleşmiyor.'); return }
    if (!validLink) return

    submittingRef.current = true; setLoading(true)
    try {
      const response = await activateAccount({ userId, token, ...form })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        if (body?.message === 'Davet bağlantısı geçersiz veya süresi dolmuş.') {
          setInvalid(true)
        } else {
          setError(body?.errors?.length ? body.errors.join(' ') : body?.message || 'Hesap etkinleştirilemedi.')
        }
        return
      }
      setSuccess(true)
      // Token artık kullanılmaz; replace sayesinde tarayıcı geçmişinde de kalmaz.
      navigate('/activate-account', { replace: true })
    } catch {
      setError('Hesap etkinleştirilemedi. Lütfen tekrar deneyin.')
    } finally {
      submittingRef.current = false; setLoading(false)
    }
  }

  if (success) {
    return <AuthShell eyebrow="Hesap daveti" title="Hesabınız etkinleştirildi"><div className="auth-success" role="status"><CheckIcon size={16} /><span>Hesabınız başarıyla etkinleştirildi.</span></div><p className="auth-lead">Artık kullanıcı adınız ve şifrenizle giriş yapabilirsiniz.</p><Button className="login-submit" onClick={() => navigate('/login')}>Giriş Yap</Button></AuthShell>
  }
  if (!validLink) return <InvitationFailure missing />
  if (invalid) return <InvitationFailure />

  return <AuthShell eyebrow="Hesap daveti" title="Hesabınızı etkinleştirin">
    <p className="auth-lead">Hesabınızı kullanmaya başlamak için şifrenizi belirleyin.</p>
    <form onSubmit={submit} noValidate>
      <TextField id="activation-password" label="Yeni şifre" icon={<LockIcon size={19} />} type={showPassword ? 'text' : 'password'} value={form.password} onChange={setField('password')} autoComplete="new-password" placeholder="En az 8 karakter" autoFocus required trailing={<IconButton label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'} onClick={() => setShowPassword((value) => !value)} className="login-eye-toggle">{showPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}</IconButton>} />
      <TextField id="activation-confirm" label="Şifre tekrar" icon={<LockIcon size={19} />} type={showPassword ? 'text' : 'password'} value={form.confirmPassword} onChange={setField('confirmPassword')} autoComplete="new-password" placeholder="Şifrenizi tekrar girin" required />
      <p className="auth-note">Şifreniz en az 8 karakter olmalı; büyük harf, küçük harf ve rakam içermelidir.</p>
      {error && <div className="login-error" role="alert"><AlertIcon size={15} /><span>{error}</span></div>}
      <Button type="submit" loading={loading} className="login-submit">{loading ? 'Etkinleştiriliyor' : 'Hesabı Etkinleştir'}{!loading && <span className="login-submit-arrow" aria-hidden="true"><ArrowRightIcon size={18} /></span>}</Button>
    </form>
    <p className="auth-footer"><Link className="auth-link" to="/login">Giriş ekranına dön</Link></p>
  </AuthShell>
}
