import { useCallback, useEffect, useMemo, useState } from 'react';
import { RiAddLine, RiDeleteBinLine, RiKey2Line, RiPencilLine, RiSearchLine, RiShuffleLine } from '@remixicon/react';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Select, SelectItem } from '@/components/base/select/select';
import { Switch } from '@/components/base/switch/switch';
import { Chip } from '@/components/base/badges/chip';
import { StatusDot } from '@/components/base/badges/status-dot';
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/base/table/table';
import { apiJson, ERR_TR, jsonBody, type Me, type User } from '@/lib/api';
import { fmtDateTime, randomPassword, USERNAME_RE } from '@/lib/format';
import { Card, CardHeader, Dialog, EmptyState, useToast } from '../ui';

type Modal =
  | { kind: 'edit'; user: User }
  | { kind: 'reset'; user: User }
  | { kind: 'delete'; user: User }
  | null;

export function UsersView({ me, onSelfChanged, onChangeOwnPassword }: { me: Me; onSelfChanged: () => void; onChangeOwnPassword: () => void }) {
  const toast = useToast();
  const [users, setUsers] = useState<User[] | null>(null);
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState<Modal>(null);

  const load = useCallback(async () => {
    try { setUsers(await apiJson<User[]>('/api/users')); } catch { setUsers([]); toast('Kullanıcılar yüklenemedi', 'error'); }
  }, [toast]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr');
    return (users || []).filter((u) => !q || [u.username, u.display_name, u.email].some((f) => (f || '').toLocaleLowerCase('tr').includes(q)));
  }, [users, query]);
  const activeCount = (users || []).filter((u) => u.is_active).length;
  const adminCount = (users || []).filter((u) => u.role === 'admin' && u.is_active).length;

  return (
    <div className="flex flex-col gap-4">
      <CreateUserCard onCreated={load} />

      <Card>
        <CardHeader
          title="Kullanıcılar"
          description={users ? `${users.length} kullanıcı · ${activeCount} aktif · ${adminCount} aktif yönetici` : 'Yükleniyor…'}
          actions={
            <Input aria-label="Kullanıcı ara" placeholder="Ara…" value={query} onChange={setQuery} leadingIcon={RiSearchLine} className="w-56" />
          }
        />
        {users === null ? <EmptyState>Yükleniyor…</EmptyState>
          : shown.length === 0 ? <EmptyState>{query ? 'Eşleşen kullanıcı yok.' : 'Kullanıcı yok.'}</EmptyState>
          : (
            <Table aria-label="Kullanıcılar" size="sm">
              <TableHeader>
                <TableColumn isRowHeader>Kullanıcı</TableColumn>
                <TableColumn>Rol</TableColumn>
                <TableColumn>Giriş</TableColumn>
                <TableColumn>Durum</TableColumn>
                <TableColumn>Son giriş</TableColumn>
                <TableColumn>Oluşturulma</TableColumn>
                <TableColumn>İşlemler</TableColumn>
              </TableHeader>
              <TableBody items={shown}>
                {(u) => {
                  const self = u.id === me.id;
                  return (
                    <TableRow id={u.id}>
                      <TableCell>
                        <div className={u.is_active ? '' : 'opacity-60'}>
                          <div className="flex items-center gap-1.5 text-body-medium text-text-primary">
                            {u.username}
                            {self && <Chip variant="caption" color="neutral">Siz</Chip>}
                            {u.env_managed && <Chip variant="caption" color="neutral" title="Parolası .env dosyasından (ADMIN_PASSWORD) yönetilir">.env</Chip>}
                          </div>
                          {u.display_name && <div className="text-caption-1-regular text-text-tertiary">{u.display_name}</div>}
                          {u.email && <div className="text-caption-1-regular text-text-tertiary">{u.email}</div>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Chip variant="subtle" color={u.role === 'admin' ? 'rose' : 'neutral'}>{u.role === 'admin' ? 'Yönetici' : 'Kullanıcı'}</Chip>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {u.email && <Chip variant="subtle" color="blue">Google</Chip>}
                          {u.has_password && <Chip variant="subtle" color="neutral">Parola</Chip>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-body-2-medium text-text-secondary">
                          <StatusDot color={u.is_active ? 'green' : 'yellow'} />
                          {u.is_active ? 'Aktif' : 'Devre dışı'}
                        </span>
                      </TableCell>
                      <TableCell><span className="whitespace-nowrap text-text-tertiary">{fmtDateTime(u.last_login_at) || 'Hiç'}</span></TableCell>
                      <TableCell><span className="whitespace-nowrap text-text-tertiary">{fmtDateTime(u.created_at)}</span></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="small" variant="secondary" iconOnly leadingIcon={RiPencilLine} aria-label={`${u.username} düzenle`} onClick={() => setModal({ kind: 'edit', user: u })} />
                          {!u.env_managed && !(self && !u.has_password) && (
                            <Button size="small" variant="secondary" iconOnly leadingIcon={RiKey2Line} aria-label={`${u.username} parola`}
                              onClick={() => (self ? onChangeOwnPassword() : setModal({ kind: 'reset', user: u }))} />
                          )}
                          {!self && !u.env_managed && (
                            <Button size="small" variant="secondary" iconOnly leadingIcon={RiDeleteBinLine} aria-label={`${u.username} sil`}
                              className="text-text-error-primary" onClick={() => setModal({ kind: 'delete', user: u })} />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                }}
              </TableBody>
            </Table>
          )}
      </Card>

      {modal?.kind === 'edit' && (
        <EditUserDialog user={modal.user} self={modal.user.id === me.id} onClose={() => setModal(null)}
          onSaved={() => { toast('Kullanıcı güncellendi', 'success'); void load(); if (modal.user.id === me.id) onSelfChanged(); }} />
      )}
      {modal?.kind === 'reset' && (
        <ResetPasswordDialog user={modal.user} onClose={() => setModal(null)} onSaved={() => { toast('Parola sıfırlandı', 'success'); void load(); }} />
      )}
      {modal?.kind === 'delete' && (
        <Dialog
          isOpen onClose={() => setModal(null)} danger submitLabel="Sil"
          title={`"${modal.user.username}" silinsin mi?`}
          description="Bu işlem geri alınamaz. Sadece erişimi kesmek istiyorsanız kullanıcıyı silmek yerine devre dışı bırakın."
          onSubmit={async () => {
            await apiJson(`/api/users/${modal.user.id}`, { method: 'DELETE' });
            toast('Kullanıcı silindi', 'success');
            void load();
          }}
        />
      )}
    </div>
  );
}

function CreateUserCard({ onCreated }: { onCreated: () => void }) {
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [busy, setBusy] = useState(false);

  const generate = () => {
    const pw = randomPassword();
    setPassword(pw);
    setShowPw(true);
    navigator.clipboard?.writeText(pw).then(
      () => toast('Parola üretildi ve panoya kopyalandı', 'success'),
      () => toast('Parola üretildi'),
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const u = username.trim();
    if (!USERNAME_RE.test(u)) { toast(ERR_TR.invalid_username, 'error'); return; }
    const mail = role === 'admin' ? email.trim() : '';
    if (!password && !mail) { toast(role === 'admin' ? ERR_TR.login_method_required : 'Parola gerekli', 'error'); return; }
    if (password && password.length < 8) { toast(ERR_TR.password_too_short, 'error'); return; }
    setBusy(true);
    try {
      await apiJson('/api/users', jsonBody({ username: u, password, email: mail, role, display_name: displayName.trim() }));
      toast(`"${u}" eklendi`, 'success');
      setUsername(''); setDisplayName(''); setEmail(''); setPassword(''); setShowPw(false); setRole('user');
      onCreated();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Eklenemedi', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Kullanıcı Ekle"
        description="Kullanıcılar kullanıcı adı ve parolayla giriş yapar. Yöneticilere kurumsal e-posta tanımlanırsa Google ile de giriş yapabilirler; bu durumda parola isteğe bağlıdır. Parola en az 8 karakter olmalı ve kullanıcı adıyla aynı olmamalı."
      />
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 xl:items-end">
        <Input label="Kullanıcı adı" placeholder="kullanici_adi" value={username} onChange={setUsername} maxLength={64} autoComplete="off" />
        <Input label="Ad Soyad (isteğe bağlı)" placeholder="Ad Soyad" value={displayName} onChange={setDisplayName} maxLength={128} />
        <div className="flex flex-col gap-1.5">
          <span className="text-body-medium text-text-primary">Rol</span>
          <Select aria-label="Rol" selectedKey={role} onSelectionChange={(k) => setRole(k === 'admin' ? 'admin' : 'user')}>
            <SelectItem id="user">Kullanıcı</SelectItem>
            <SelectItem id="admin">Yönetici</SelectItem>
          </Select>
        </div>
        {role === 'admin' && (
          <Input
            label="Kurumsal e-posta (Google ile giriş)"
            type="email"
            placeholder="ad.soyad@beykoz.edu.tr"
            value={email}
            onChange={(v) => {
              setEmail(v);
              // Suggest a username from the address while the field is still empty.
              if (!username) { const local = v.split('@')[0]; if (/^[A-Za-z0-9_.-]{3,}$/.test(local)) setUsername(local.toLowerCase()); }
            }}
            maxLength={255}
            autoComplete="off"
          />
        )}
        <div className="flex items-end gap-2">
          <Input label={role === 'admin' && email.trim() ? 'Parola (isteğe bağlı)' : 'Parola'} type={showPw ? 'text' : 'password'} placeholder={role === 'admin' && email.trim() ? 'Yalnızca Google için boş bırakın' : 'En az 8 karakter'} value={password}
            onChange={(v) => { setPassword(v); }} autoComplete="new-password" className="min-w-0 flex-1" />
          <Button type="button" variant="secondary" iconOnly leadingIcon={RiShuffleLine} aria-label="Rastgele güçlü parola üret" title="Rastgele güçlü parola üret" onClick={generate} />
        </div>
        <Button type="submit" leadingIcon={RiAddLine} disabled={busy}>Ekle</Button>
      </form>
    </Card>
  );
}

function EditUserDialog({ user, self, onClose, onSaved }: { user: User; self: boolean; onClose: () => void; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(user.display_name || '');
  const [email, setEmail] = useState(user.email || '');
  const [role, setRole] = useState(user.role);
  const [active, setActive] = useState(user.is_active);
  const locked = self || user.env_managed;
  return (
    <Dialog
      isOpen onClose={onClose}
      title={`Kullanıcıyı düzenle: ${user.username}`}
      description={user.env_managed
        ? 'Bu yönetici hesabının parolası .env dosyasından (ADMIN_PASSWORD) yönetilir; rolü ve durumu buradan değiştirilemez.'
        : self
          ? 'Kendi rolünüzü değiştiremez ve hesabınızı devre dışı bırakamazsınız.'
          : 'Devre dışı bırakılan kullanıcı giriş yapamaz ve açık oturumları hemen kapanır.'}
      onSubmit={async () => {
        // Google sign-in is for admins only: a non-admin keeps no email.
        const patch: Record<string, unknown> = { display_name: displayName.trim(), email: role === 'admin' ? email.trim() : '' };
        if (!locked) { patch.role = role; patch.is_active = active; }
        await apiJson(`/api/users/${user.id}`, jsonBody(patch, 'PATCH'));
        onSaved();
      }}
    >
      <Input label="Ad Soyad" value={displayName} onChange={setDisplayName} maxLength={128} autoFocus />
      <div className="flex flex-col gap-1.5">
        <span className="text-body-medium text-text-primary">Rol</span>
        <Select aria-label="Rol" selectedKey={role} isDisabled={locked} onSelectionChange={(k) => setRole(k === 'admin' ? 'admin' : 'user')}>
          <SelectItem id="user">Kullanıcı</SelectItem>
          <SelectItem id="admin">Yönetici</SelectItem>
        </Select>
      </div>
      {role === 'admin' ? (
        <Input
          label="Kurumsal e-posta (Google ile giriş)"
          type="email"
          placeholder="ad.soyad@beykoz.edu.tr"
          value={email}
          onChange={setEmail}
          maxLength={255}
          hint={user.has_password ? 'Boş bırakırsanız yalnızca parolayla giriş yapılır.' : 'Bu hesabın parolası yok; Google ile giriş için e-posta gerekli.'}
        />
      ) : user.email ? (
        <p className="text-caption-1-regular text-text-tertiary">Google ile giriş yalnızca yöneticiler içindir; kayıtlı e-posta ({user.email}) kaldırılacak.</p>
      ) : null}
      <Switch isSelected={active} onChange={setActive} isDisabled={locked}>Hesap aktif</Switch>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  return (
    <Dialog
      isOpen onClose={onClose} submitLabel={user.has_password ? 'Parolayı Sıfırla' : 'Parola Belirle'}
      title={`${user.has_password ? 'Parola sıfırla' : 'Parola belirle'}: ${user.username}`}
      description={user.has_password
        ? 'Yeni parola belirlendiğinde kullanıcının tüm açık oturumları kapatılır.'
        : 'Bu hesap şu an yalnızca Google ile giriş yapıyor. Parola belirlerseniz kullanıcı adı ve parolayla da giriş yapabilir.'}
      onSubmit={async () => {
        if (pw.length < 8) throw new Error(ERR_TR.password_too_short);
        if (pw !== confirm) throw new Error('Parolalar eşleşmiyor');
        await apiJson(`/api/users/${user.id}/password`, jsonBody({ new_password: pw }, 'PUT'));
        onSaved();
      }}
    >
      <div className="flex items-end gap-2">
        <Input label="Yeni parola" type={show ? 'text' : 'password'} value={pw} onChange={setPw} autoComplete="new-password" hint="En az 8 karakter" className="min-w-0 flex-1" autoFocus />
        <Button type="button" variant="secondary" iconOnly leadingIcon={RiShuffleLine} aria-label="Rastgele parola üret" className="mb-6"
          onClick={() => {
            const g = randomPassword();
            setPw(g); setConfirm(g); setShow(true);
            navigator.clipboard?.writeText(g).then(() => toast('Parola üretildi ve panoya kopyalandı', 'success'), () => {});
          }} />
      </div>
      <Input label="Yeni parola (tekrar)" type={show ? 'text' : 'password'} value={confirm} onChange={setConfirm} autoComplete="new-password" />
    </Dialog>
  );
}
