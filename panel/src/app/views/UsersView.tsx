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
    return (users || []).filter((u) => !q || u.username.toLocaleLowerCase('tr').includes(q) || (u.display_name || '').toLocaleLowerCase('tr').includes(q));
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
                          </div>
                          {u.display_name && <div className="text-caption-1-regular text-text-tertiary">{u.display_name}</div>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Chip variant="subtle" color={u.role === 'admin' ? 'rose' : 'neutral'}>{u.role === 'admin' ? 'Yönetici' : 'Kullanıcı'}</Chip>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-body-medium text-text-primary">
                          <StatusDot color={u.is_active ? 'green' : 'yellow'} />
                          {u.is_active ? 'Aktif' : 'Devre dışı'}
                        </span>
                      </TableCell>
                      <TableCell><span className="whitespace-nowrap text-text-tertiary">{fmtDateTime(u.last_login_at) || 'Hiç'}</span></TableCell>
                      <TableCell><span className="whitespace-nowrap text-text-tertiary">{fmtDateTime(u.created_at)}</span></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="small" variant="secondary" iconOnly leadingIcon={RiPencilLine} aria-label={`${u.username} düzenle`} onClick={() => setModal({ kind: 'edit', user: u })} />
                          <Button size="small" variant="secondary" iconOnly leadingIcon={RiKey2Line} aria-label={`${u.username} parola`}
                            onClick={() => (self ? onChangeOwnPassword() : setModal({ kind: 'reset', user: u }))} />
                          {!self && (
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
    if (password.length < 8) { toast(ERR_TR.password_too_short, 'error'); return; }
    setBusy(true);
    try {
      await apiJson('/api/users', jsonBody({ username: u, password, role, display_name: displayName.trim() }));
      toast(`"${u}" eklendi`, 'success');
      setUsername(''); setDisplayName(''); setPassword(''); setShowPw(false); setRole('user');
      onCreated();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Eklenemedi', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Kullanıcı Ekle" description="Yeni yönetici veya yayıncı hesabı oluşturun. Parola en az 8 karakter olmalı ve kullanıcı adıyla aynı olmamalı." />
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1.2fr_auto_auto] xl:items-end">
        <Input label="Kullanıcı adı" placeholder="kullanici_adi" value={username} onChange={setUsername} maxLength={64} autoComplete="off" />
        <Input label="Ad Soyad (isteğe bağlı)" placeholder="Ad Soyad" value={displayName} onChange={setDisplayName} maxLength={128} />
        <div className="flex items-end gap-2">
          <Input label="Parola" type={showPw ? 'text' : 'password'} placeholder="En az 8 karakter" value={password}
            onChange={(v) => { setPassword(v); }} autoComplete="new-password" className="min-w-0 flex-1" />
          <Button type="button" variant="secondary" iconOnly leadingIcon={RiShuffleLine} aria-label="Rastgele güçlü parola üret" title="Rastgele güçlü parola üret" onClick={generate} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-body-medium text-text-primary">Rol</span>
          <Select aria-label="Rol" selectedKey={role} onSelectionChange={(k) => setRole(k === 'admin' ? 'admin' : 'user')}>
            <SelectItem id="user">Kullanıcı</SelectItem>
            <SelectItem id="admin">Yönetici</SelectItem>
          </Select>
        </div>
        <Button type="submit" leadingIcon={RiAddLine} disabled={busy}>Ekle</Button>
      </form>
    </Card>
  );
}

function EditUserDialog({ user, self, onClose, onSaved }: { user: User; self: boolean; onClose: () => void; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(user.display_name || '');
  const [role, setRole] = useState(user.role);
  const [active, setActive] = useState(user.is_active);
  return (
    <Dialog
      isOpen onClose={onClose}
      title={`Kullanıcıyı düzenle: ${user.username}`}
      description={self
        ? 'Kendi rolünüzü değiştiremez ve hesabınızı devre dışı bırakamazsınız.'
        : 'Devre dışı bırakılan kullanıcı giriş yapamaz ve açık oturumları hemen kapanır.'}
      onSubmit={async () => {
        const patch: Record<string, unknown> = { display_name: displayName.trim() };
        if (!self) { patch.role = role; patch.is_active = active; }
        await apiJson(`/api/users/${user.id}`, jsonBody(patch, 'PATCH'));
        onSaved();
      }}
    >
      <Input label="Ad Soyad" value={displayName} onChange={setDisplayName} maxLength={128} autoFocus />
      <div className="flex flex-col gap-1.5">
        <span className="text-body-medium text-text-primary">Rol</span>
        <Select aria-label="Rol" selectedKey={role} isDisabled={self} onSelectionChange={(k) => setRole(k === 'admin' ? 'admin' : 'user')}>
          <SelectItem id="user">Kullanıcı</SelectItem>
          <SelectItem id="admin">Yönetici</SelectItem>
        </Select>
      </div>
      <Switch isSelected={active} onChange={setActive} isDisabled={self}>Hesap aktif</Switch>
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
      isOpen onClose={onClose} submitLabel="Parolayı Sıfırla"
      title={`Parola sıfırla: ${user.username}`}
      description="Yeni parola belirlendiğinde kullanıcının tüm açık oturumları kapatılır."
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
