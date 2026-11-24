import { useCallback, useEffect, useState, useSyncExternalStore, type ComponentType } from 'react';
import {
  RiFileList3Line, RiHistoryLine, RiLockPasswordLine, RiLogoutBoxRLine, RiMicLine,
  RiSettings4Line, RiTeamLine,
} from '@remixicon/react';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Chip } from '@/components/base/badges/chip';
import { cx } from '@/utils/cx';
import { apiJson, clearSession, getToken, jsonBody, setToken, setUnauthorizedHandler, ERR_TR, SSO_ERR_TR, type Me } from '@/lib/api';
import { broadcast } from '@/lib/broadcast';
import { Dialog, ToastProvider, useToast } from './ui';
import { BroadcastView } from './views/BroadcastView';
import { HistoryView } from './views/HistoryView';
import { UsersView } from './views/UsersView';
import { LogsView } from './views/LogsView';
import { SettingsView } from './views/SettingsView';

type ViewKey = 'broadcast' | 'history' | 'users' | 'logs' | 'settings';
type Icon = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;

const NAV: { key: ViewKey; label: string; icon: Icon; adminOnly?: boolean }[] = [
  { key: 'broadcast', label: 'Canlı Yayın', icon: RiMicLine },
  { key: 'history', label: 'Geçmiş', icon: RiHistoryLine },
  { key: 'users', label: 'Kullanıcılar', icon: RiTeamLine, adminOnly: true },
  { key: 'logs', label: 'Sistem Logları', icon: RiFileList3Line, adminOnly: true },
  { key: 'settings', label: 'Ayarlar', icon: RiSettings4Line, adminOnly: true },
];
const TITLES: Record<ViewKey, string> = {
  broadcast: 'Canlı Yayın', history: 'Geçmiş', users: 'Kullanıcı Yönetimi', logs: 'Sistem Logları', settings: 'Ayarlar',
};

export function App() {
  return (
    <ToastProvider>
      <Root />
    </ToastProvider>
  );
}

/** Result of a Google sign-in, handed back by the server in the URL fragment. */
function readSsoFragment(): { code?: string; error?: string } {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const code = params.get('sso') || undefined;
  const error = params.get('sso_error') || undefined;
  if (code || error) {
    // Remove it at once: the code is single-use and must not stay in history.
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return { code, error };
}

// StrictMode runs effects twice in development; the code is single-use.
let ssoExchangeStarted = false;

function Root() {
  const [me, setMe] = useState<Me | null>(null);
  const [sso] = useState(readSsoFragment);
  const [ssoError, setSsoError] = useState(sso.error ? SSO_ERR_TR[sso.error] || SSO_ERR_TR.invalid : '');
  const [checking, setChecking] = useState(Boolean(getToken() || sso.code));

  const logout = useCallback(() => {
    broadcast.stop();
    clearSession();
    setMe(null);
  }, []);

  const loadMe = useCallback(async () => {
    try {
      const d = await apiJson<Me & { status: string }>('/api/auth/me');
      setMe({ id: d.id, username: d.username, display_name: d.display_name, email: d.email || '', has_password: d.has_password !== false, role: d.role });
    } catch {
      clearSession();
      setMe(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    broadcast.onAuthExpired = logout;
    if (sso.code) {
      if (ssoExchangeStarted) return;
      ssoExchangeStarted = true;
      // Trade the single-use code from Google sign-in for the panel token.
      fetch('/api/auth/saml/exchange', jsonBody({ code: sso.code }))
        .then(async (res) => {
          const d = await res.json().catch(() => ({}));
          if (!res.ok || !d.access_token) throw new Error(ERR_TR[d.code] || SSO_ERR_TR.invalid);
          setToken(d.access_token);
          await loadMe();
        })
        .catch((err) => { setSsoError(err.message); setChecking(false); });
      return;
    }
    if (getToken()) void loadMe();
  }, [loadMe, logout, sso.code]);

  if (checking) return <div className="grid h-full place-items-center text-body-regular text-text-tertiary">Yükleniyor…</div>;
  if (!me) return <LoginScreen onLoggedIn={loadMe} initialError={ssoError} />;
  return <Shell me={me} onLogout={logout} onMeChanged={loadMe} />;
}

/* ── Login ──────────────────────────────────────────────────────────────── */
function LoginScreen({ onLoggedIn, initialError = '' }: { onLoggedIn: () => void; initialError?: string }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState<{ enabled: boolean; domain: string } | null>(null);

  useEffect(() => {
    fetch('/api/auth/saml/status').then((r) => r.json()).then(setGoogle).catch(() => setGoogle(null));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) { setError('Kullanıcı adı ve parola gerekli'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', jsonBody({ username: username.trim(), password }));
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(ERR_TR[d.code] || (res.status === 429 ? 'Çok fazla deneme. Lütfen daha sonra tekrar deneyin.' : 'Hatalı kullanıcı adı veya parola'));
      }
      setToken(d.access_token);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Giriş başarısız');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-full items-center justify-center bg-background-full p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl border border-border-button-default bg-background-primary-default p-8 shadow-card">
        <Brand className="mb-6" />
        <h1 className="text-title-2-semibold text-text-primary">Yönetim Paneli</h1>
        <p className="mt-1 mb-6 text-body-regular text-text-secondary">Yayını başlatmak için giriş yapın.</p>
        {google?.enabled && (
          <>
            <a
              href="/api/auth/saml/login"
              className="flex h-10 w-full items-center justify-center gap-2 rounded-2lg border border-border-button-default bg-background-primary-default text-body-medium text-text-primary shadow-xs outline-none hover:bg-background-primary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:ring-offset-2"
            >
              <GoogleMark />
              Google ile giriş yap
            </a>
            <p className="mt-2 text-center text-caption-1-regular text-text-tertiary">@{google.domain} hesabınızla</p>
            <div className="my-5 flex items-center gap-3 text-caption-1-medium text-text-tertiary" aria-hidden>
              <span className="h-px flex-1 bg-separator-border" /> veya <span className="h-px flex-1 bg-separator-border" />
            </div>
          </>
        )}
        <div className="flex flex-col gap-4">
          <Input label="Kullanıcı adı" value={username} onChange={setUsername} autoComplete="username" autoFocus />
          <Input label="Parola" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        </div>
        <p role="alert" className="mt-3 min-h-5 text-body-2-medium text-text-error-primary">{error}</p>
        <Button type="submit" className="mt-2 w-full" disabled={busy}>{busy ? 'Giriş yapılıyor…' : 'Giriş Yap'}</Button>
      </form>
    </main>
  );
}

/** Google "G" mark (official colors), for the sign-in button. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-[18px]" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function Brand({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <div className={cx('flex items-center gap-2', className)}>
      <span className="grid size-8 place-items-center rounded-lg bg-linear-to-b from-accent-500 to-accent-600 text-caption-1-bold text-white shadow-nav-selected">BT</span>
      <span className={cx('text-headline-semibold', inverted ? 'text-white' : 'text-text-primary')}>B-Translate</span>
    </div>
  );
}

/* ── Shell: sidebar + top bar + view ────────────────────────────────────── */
function Shell({ me, onLogout, onMeChanged }: { me: Me; onLogout: () => void; onMeChanged: () => void }) {
  const [view, setView] = useState<ViewKey>('broadcast');
  const [pwOpen, setPwOpen] = useState(false);
  const isAdmin = me.role === 'admin';
  const items = NAV.filter((n) => isAdmin || !n.adminOnly);
  const toast = useToast();
  const b = useSyncExternalStore(broadcast.subscribe, broadcast.getState);

  useEffect(() => { broadcast.onToast = (msg, status) => toast(msg, status === 'error' ? 'error' : status === 'success' ? 'success' : 'neutral'); }, [toast]);

  return (
    <div className="flex min-h-full flex-col bg-background-full lg:flex-row">
      {/* Sidebar (desktop) / top nav (mobile) */}
      <aside className="flex shrink-0 flex-col gap-3 border-separator-border bg-background-secondary-default p-3 max-lg:border-b lg:sticky lg:top-0 lg:h-screen lg:w-[260px] lg:border-e">
        <div className="flex items-center justify-between px-1 py-1">
          <Brand />
          <div className="flex items-center gap-1 lg:hidden">
            {me.has_password && <Button variant="secondary" size="small" iconOnly leadingIcon={RiLockPasswordLine} aria-label="Parolamı değiştir" onClick={() => setPwOpen(true)} />}
            <Button variant="secondary" size="small" iconOnly leadingIcon={RiLogoutBoxRLine} aria-label="Çıkış yap" onClick={onLogout} />
          </div>
        </div>
        <nav aria-label="Panel" className="flex gap-1 overflow-x-auto max-lg:pb-1 lg:flex-col">
          {items.map((item) => (
            <NavRow key={item.key} icon={item.icon} label={item.label} selected={view === item.key} onClick={() => setView(item.key)} />
          ))}
        </nav>
        <div className="mt-auto hidden flex-col gap-1 border-t border-separator-border pt-3 lg:flex">
          <div className="flex items-center gap-2 px-2 pb-2">
            <span className="grid size-8 place-items-center rounded-full bg-background-tertiary-default text-caption-1-semibold text-text-secondary">
              {(me.display_name || me.username).slice(0, 1).toLocaleUpperCase('tr')}
            </span>
            <div className="min-w-0">
              <div className="truncate text-body-medium text-text-primary">{me.display_name || me.username}</div>
              <div className="truncate text-caption-1-regular text-text-tertiary">{isAdmin ? 'Yönetici' : 'Kullanıcı'}{me.email ? ` · ${me.email}` : ''}</div>
            </div>
          </div>
          {me.has_password && <NavRow icon={RiLockPasswordLine} label="Parolamı Değiştir" onClick={() => setPwOpen(true)} />}
          <NavRow icon={RiLogoutBoxRLine} label="Çıkış Yap" onClick={onLogout} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-separator-border bg-background-primary-default/90 px-4 py-3 backdrop-blur sm:px-6">
          <h1 className="text-title-3-semibold text-text-primary">{TITLES[view]}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Chip variant="subtle" color={b.live ? 'lime' : 'neutral'}>
              <span className={cx('me-1.5 inline-block size-2 rounded-full', b.live ? 'bg-green-500' : 'bg-neutral-400')} aria-hidden />
              {b.live ? 'Yayında' : 'Yayın kapalı'}
            </Chip>
            <Chip variant="subtle" color="neutral">{b.participants} dinleyici</Chip>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">
          {view === 'broadcast' && <BroadcastView />}
          {view === 'history' && <HistoryView />}
          {view === 'users' && isAdmin && <UsersView me={me} onSelfChanged={onMeChanged} onChangeOwnPassword={() => setPwOpen(true)} />}
          {view === 'logs' && isAdmin && <LogsView />}
          {view === 'settings' && isAdmin && <SettingsView />}
        </main>
      </div>

      <ChangeOwnPasswordDialog isOpen={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}

/** Navigation row — BoardUI DashboardSidebar NavItem styling. */
function NavRow({ icon: Icon, label, selected, onClick }: { icon: Icon; label: string; selected?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? 'page' : undefined}
      className={cx(
        'flex shrink-0 items-center gap-2 rounded-2lg p-2 text-start outline-none lg:w-full',
        'focus-visible:ring-2 focus-visible:ring-border-focus-ring',
        selected ? 'bg-linear-to-b from-accent-500 to-accent-600 shadow-nav-selected' : 'hover:bg-background-secondary-hover',
      )}
    >
      <Icon className={cx('size-5 shrink-0', selected ? 'text-white' : 'text-foreground-icon-secondary')} aria-hidden />
      <span className={cx('text-body-medium whitespace-nowrap', selected ? 'text-white' : 'text-text-secondary')}>{label}</span>
    </button>
  );
}

function ChangeOwnPasswordDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const close = () => { setCurrent(''); setNext(''); setConfirm(''); onClose(); };
  return (
    <Dialog
      isOpen={isOpen}
      onClose={close}
      title="Parolamı Değiştir"
      description="Parolanız değiştiğinde diğer cihazlardaki oturumlarınız kapatılır; bu sekmede oturumunuz açık kalır."
      submitLabel="Değiştir"
      onSubmit={async () => {
        if (!current) throw new Error('Mevcut parolanızı girin');
        if (next.length < 8) throw new Error(ERR_TR.password_too_short);
        if (next !== confirm) throw new Error('Parolalar eşleşmiyor');
        const d = await apiJson<{ access_token?: string }>('/api/auth/change-password', jsonBody({ current_password: current, new_password: next }));
        if (d.access_token) setToken(d.access_token);
        toast('Parolanız değiştirildi', 'success');
        setCurrent(''); setNext(''); setConfirm('');
      }}
    >
      <Input label="Mevcut parola" type="password" value={current} onChange={setCurrent} autoComplete="current-password" autoFocus />
      <Input label="Yeni parola" type="password" value={next} onChange={setNext} autoComplete="new-password" hint="En az 8 karakter" />
      <Input label="Yeni parola (tekrar)" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
    </Dialog>
  );
}

