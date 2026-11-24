import { useCallback, useEffect, useMemo, useState } from 'react';
import { RiAddLine, RiDeleteBinLine, RiKey2Line, RiPencilLine, RiSearchLine, RiShuffleLine } from '@remixicon/react';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Switch } from '@/components/base/switch/switch';
import { Chip } from '@/components/base/badges/chip';
import { StatusDot } from '@/components/base/badges/status-dot';
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/base/table/table';
import { apiJson, ERR_TR, jsonBody, type Me, type User } from '@/lib/api';
import { fmtDateTime, randomPassword } from '@/lib/format';
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

  return (
    <div className="flex flex-col gap-4">
      <CreateUserCard onCreated={load} />

      <Card>
        <CardHeader
          title="Kullanıcılar"
          description={users ? `${users.length} kullanıcı · ${activeCount} aktif` : 'Yükleniyor…'}
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
                          {u.has_password && !u.env_managed && (
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

const EMAIL_DOMAIN = 'beykoz.edu.tr';

/** "ad.soyad" or "ad.soyad@beykoz.edu.tr" → full lowercase address. */
function toInstitutionalEmail(raw: string) {
  const v = raw.trim().toLowerCase();
  return v && !v.includes('@') ? `${v}@${EMAIL_DOMAIN}` : v;
}

function CreateUserCard({ onCreated }: { onCreated: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const mail = toInstitutionalEmail(email);
    if (!mail.endsWith(`@${EMAIL_DOMAIN}`) || !/^[a-z0-9._%+-]+@/.test(mail)) { toast(ERR_TR.invalid_email, 'error'); return; }
    setBusy(true);
    try {
      await apiJson('/api/users', jsonBody({ email: mail }));
      toast(`${mail} eklendi`, 'success');
      setEmail('');
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
        description={`Kurumsal e-posta adresini girin; eklenen kişi panele Google hesabıyla (@${EMAIL_DOMAIN}) giriş yapar.`}
      />
      <form onSubmit={submit} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Input
          label="Kurumsal e-posta"
          type="email"
          placeholder={`ad.soyad@${EMAIL_DOMAIN}`}
          value={email}
          onChange={setEmail}
          maxLength={255}
          autoComplete="off"
          className="min-w-0 flex-1"
        />
        <Button type="submit" leadingIcon={RiAddLine} disabled={busy || !email.trim()}>Ekle</Button>
      </form>
    </Card>
  );
}

function EditUserDialog({ user, self, onClose, onSaved }: { user: User; self: boolean; onClose: () => void; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(user.display_name || '');
  const [email, setEmail] = useState(user.email || '');
  const [active, setActive] = useState(user.is_active);
  const locked = self || user.env_managed;
  return (
    <Dialog
      isOpen onClose={onClose}
      title={`Kullanıcıyı düzenle: ${user.username}`}
      description={user.env_managed
        ? 'Bu hesabın parolası .env dosyasından (ADMIN_PASSWORD) yönetilir; durumu buradan değiştirilemez.'
        : self
          ? 'Kendi hesabınızı devre dışı bırakamazsınız.'
          : 'Devre dışı bırakılan kullanıcı giriş yapamaz ve açık oturumları hemen kapanır.'}
      onSubmit={async () => {
        const mail = toInstitutionalEmail(email);
        const patch: Record<string, unknown> = { display_name: displayName.trim(), email: mail };
        // Every panel account signs in as an admin; bring older accounts in line.
        if (mail && user.role !== 'admin' && !locked) patch.role = 'admin';
        if (!locked) patch.is_active = active;
        await apiJson(`/api/users/${user.id}`, jsonBody(patch, 'PATCH'));
        onSaved();
      }}
    >
      <Input label="Ad Soyad" value={displayName} onChange={setDisplayName} maxLength={128} autoFocus />
      <Input
        label="Kurumsal e-posta"
        type="email"
        placeholder={`ad.soyad@${EMAIL_DOMAIN}`}
        value={email}
        onChange={setEmail}
        maxLength={255}
        hint={user.has_password ? 'Boş bırakırsanız yalnızca parolayla giriş yapılır.' : 'Google ile giriş için gerekli.'}
      />
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
