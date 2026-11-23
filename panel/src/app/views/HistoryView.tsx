import { useCallback, useEffect, useState } from 'react';
import { RiDownload2Line, RiEyeLine } from '@remixicon/react';
import { Button } from '@/components/base/buttons/button';
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/base/table/table';
import { apiJson, download, type DayCount, type HistoryRow } from '@/lib/api';
import { DAY_RE, fmtDay } from '@/lib/format';
import { Card, CardHeader, EmptyState, useToast } from '../ui';

export function HistoryView() {
  const toast = useToast();
  const [days, setDays] = useState<DayCount[] | null>(null);
  const [error, setError] = useState(false);
  const [preview, setPreview] = useState<{ day: string; rows: HistoryRow[] | null } | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      const rows = await apiJson<DayCount[]>('/api/history/days');
      setDays(rows.filter((r) => DAY_RE.test(r.day)));
    } catch { setError(true); setDays([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const openPreview = async (day: string) => {
    setPreview({ day, rows: null });
    try {
      const rows = await apiJson<HistoryRow[]>(`/api/history/segments?date=${day}`);
      setPreview({ day, rows });
      requestAnimationFrame(() => document.getElementById('history-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch { setPreview(null); toast('Döküm yüklenemedi', 'error'); }
  };
  const dl = (day: string, format: string) =>
    download(`/api/history/export?date=${day}&format=${format}`).catch(() => toast('İndirilemedi', 'error'));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Çeviri Geçmişi"
          description="Tüm kesinleşmiş çeviriler gün bazında saklanır. Bir günün dökümünü görüntüleyin veya TXT / CSV / JSON olarak indirin."
        />
        {days === null ? <EmptyState>Yükleniyor…</EmptyState>
          : error ? <EmptyState>Yüklenemedi.</EmptyState>
          : days.length === 0 ? <EmptyState>Henüz kayıt yok.</EmptyState>
          : (
            <Table aria-label="Geçmiş günler" size="sm">
              <TableHeader>
                <TableColumn isRowHeader>Tarih</TableColumn>
                <TableColumn>Kayıt</TableColumn>
                <TableColumn>İşlemler</TableColumn>
              </TableHeader>
              <TableBody items={days.map((d) => ({ ...d, id: d.day }))}>
                {(d) => (
                  <TableRow id={d.day}>
                    <TableCell><span className="text-body-medium text-text-primary">{fmtDay(d.day)}</span></TableCell>
                    <TableCell><span className="tabular-nums">{d.count}</span></TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        <Button size="small" variant="secondary" leadingIcon={RiEyeLine} onClick={() => void openPreview(d.day)}>Görüntüle</Button>
                        <Button size="small" variant="ghost" leadingIcon={RiDownload2Line} onClick={() => dl(d.day, 'txt')}>TXT</Button>
                        <Button size="small" variant="secondary" onClick={() => dl(d.day, 'csv')}>CSV</Button>
                        <Button size="small" variant="secondary" onClick={() => dl(d.day, 'json')}>JSON</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
      </Card>

      {preview && (
        <Card className="scroll-mt-20">
          <div id="history-preview" />
          <CardHeader
            title={`${fmtDay(preview.day)} — Döküm`}
            description={preview.rows ? `${preview.rows.length} kayıt` : 'Yükleniyor…'}
            actions={<Button size="small" variant="secondary" onClick={() => setPreview(null)}>Kapat</Button>}
          />
          {preview.rows && (preview.rows.length === 0 ? <EmptyState>Kayıt yok.</EmptyState> : (
            <Table aria-label="Günün dökümü" size="sm">
              <TableHeader>
                <TableColumn>Saat</TableColumn>
                <TableColumn isRowHeader>Orijinal</TableColumn>
                <TableColumn>Çeviri</TableColumn>
              </TableHeader>
              <TableBody items={preview.rows.map((r, i) => ({ ...r, id: i }))}>
                {(r) => (
                  <TableRow id={r.id}>
                    <TableCell><span className="tabular-nums text-text-tertiary">{r.time}</span></TableCell>
                    <TableCell><span className="whitespace-normal">{r.original}</span></TableCell>
                    <TableCell>
                      {r.translation
                        ? <span className="whitespace-normal text-body-medium text-text-primary">{r.translation}</span>
                        : <span className="text-text-tertiary">(çevrilemedi)</span>}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          ))}
        </Card>
      )}
    </div>
  );
}
