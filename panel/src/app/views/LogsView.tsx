import { useCallback, useEffect, useState } from 'react';
import { RiDownload2Line, RiRefreshLine } from '@remixicon/react';
import { Button } from '@/components/base/buttons/button';
import { Select, SelectItem } from '@/components/base/select/select';
import { Chip } from '@/components/base/badges/chip';
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/base/table/table';
import { apiJson, download, type DayCount, type LogRow } from '@/lib/api';
import { DAY_RE, localDay } from '@/lib/format';
import { Card, CardHeader, EmptyState, useToast } from '../ui';

const LEVEL_COLOR: Record<string, 'blue' | 'yellow' | 'rose' | 'neutral'> = {
  INFO: 'blue', WARN: 'yellow', ERROR: 'rose', DEBUG: 'neutral',
};

export function LogsView() {
  const toast = useToast();
  const [days, setDays] = useState<DayCount[]>([]);
  const [day, setDay] = useState('');
  const [level, setLevel] = useState('ALL');
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    apiJson<DayCount[]>('/api/logs/days')
      .then((list) => {
        const clean = list.filter((d) => DAY_RE.test(d.day));
        const today = localDay();
        if (!clean.some((d) => d.day === today)) clean.unshift({ day: today, count: 0 });
        setDays(clean);
        setDay(clean[0]?.day || today);
      })
      .catch(() => { setError(true); setRows([]); });
  }, []);

  const load = useCallback(async () => {
    if (!day) return;
    setRows(null);
    setError(false);
    try {
      const q = `date=${encodeURIComponent(day)}${level !== 'ALL' ? `&level=${encodeURIComponent(level)}` : ''}`;
      setRows(await apiJson<LogRow[]>(`/api/logs?${q}`));
    } catch { setError(true); setRows([]); }
  }, [day, level]);
  useEffect(() => { void load(); }, [load]);

  return (
    <Card>
      <CardHeader
        title="Sistem Logları"
        description="Bağlantı ve oturum olayları gün bazında kaydedilir; 30 günden eski loglar otomatik silinir. Ses ve çeviri içeriği loglanmaz."
      />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-body-medium text-text-primary">Gün</span>
          <Select aria-label="Gün" selectedKey={day || null} onSelectionChange={(k) => setDay(String(k))} className="min-w-52">
            {days.map((d) => <SelectItem key={d.day} id={d.day}>{`${d.day} (${d.count})`}</SelectItem>)}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-body-medium text-text-primary">Seviye</span>
          <Select aria-label="Seviye" selectedKey={level} onSelectionChange={(k) => setLevel(String(k))} className="min-w-32">
            <SelectItem id="ALL">Tümü</SelectItem>
            <SelectItem id="INFO">INFO</SelectItem>
            <SelectItem id="WARN">WARN</SelectItem>
            <SelectItem id="ERROR">ERROR</SelectItem>
          </Select>
        </div>
        <Button variant="secondary" leadingIcon={RiRefreshLine} onClick={() => void load()}>Yenile</Button>
        <Button variant="ghost" leadingIcon={RiDownload2Line} disabled={!day}
          onClick={() => download(`/api/logs/export?date=${day}`).catch(() => toast('İndirilemedi', 'error'))}>
          TXT indir
        </Button>
      </div>

      {rows === null ? <EmptyState>Yükleniyor…</EmptyState>
        : error ? <EmptyState>Yüklenemedi.</EmptyState>
        : rows.length === 0 ? <EmptyState>Bu gün için log yok.</EmptyState>
        : (
          <Table aria-label="Loglar" size="sm">
            <TableHeader>
              <TableColumn>Zaman</TableColumn>
              <TableColumn>Seviye</TableColumn>
              <TableColumn isRowHeader>Mesaj</TableColumn>
            </TableHeader>
            <TableBody items={rows}>
              {(r) => (
                <TableRow id={r.id}>
                  <TableCell><span className="whitespace-nowrap tabular-nums text-text-tertiary">{r.created_at}</span></TableCell>
                  <TableCell><Chip variant="subtle" color={LEVEL_COLOR[r.level] || 'neutral'}>{r.level}</Chip></TableCell>
                  <TableCell><span className="font-mono text-body-2-regular break-words whitespace-normal">{r.message}</span></TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
    </Card>
  );
}
