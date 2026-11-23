import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import QRCode from 'qrcode';
import {
  RiDownload2Line, RiExternalLinkLine, RiMicLine, RiRefreshLine, RiStopCircleLine,
} from '@remixicon/react';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Select, SelectItem } from '@/components/base/select/select';
import { SegmentedControl, SegmentedControlItem } from '@/components/base/segmented-control/segmented-control';
import { StatusDot } from '@/components/base/badges/status-dot';
import { cx } from '@/utils/cx';
import { apiJson, download, jsonBody, type Direction, type Settings } from '@/lib/api';
import { broadcast, EVENT_CODE } from '@/lib/broadcast';
import { localDay } from '@/lib/format';
import { Card, CardHeader, useToast } from '../ui';

const participantUrl = () => `${location.origin}/participant?code=${EVENT_CODE}`;

function readLS(key: string) { try { return localStorage.getItem(key) || ''; } catch { return ''; } }
function writeLS(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* ignore */ }
}

export function BroadcastView() {
  const toast = useToast();
  const b = useSyncExternalStore(broadcast.subscribe, broadcast.getState);
  const [hasSession, setHasSession] = useState(() => Boolean(readLS('bt_event_code')));
  const [eventName, setEventName] = useState(() => readLS('bt_event_name'));
  const [creating, setCreating] = useState(false);
  const nameRef = useRef(eventName);
  nameRef.current = eventName;

  // Wire the controller to this view's state.
  useEffect(() => {
    broadcast.getEventName = () => nameRef.current;
    broadcast.onServerTitle = (title) => {
      if (!nameRef.current.trim()) { setEventName(title); writeLS('bt_event_name', title); }
    };
  }, []);

  // Directions + the admin's segmentation tuning (any signed-in host may read it).
  useEffect(() => {
    apiJson<{ directions?: Direction[] }>('/api/sessions/config')
      .then((d) => { if (Array.isArray(d.directions)) broadcast.setDirections(d.directions); })
      .catch(() => {});
    apiJson<Settings>('/api/settings')
      .then((s) => broadcast.setFlushConfig({
        flush_on_punctuation: s.flush_on_punctuation !== false,
        max_words: Math.max(0, Number(s.max_words) || 0),
        silence_ms: Math.min(5000, Math.max(200, Number(s.silence_ms) || 500)),
      }))
      .catch(() => {});
    void broadcast.refreshMics();
    return () => broadcast.stopMonitor();
  }, []);

  const createSession = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = eventName.trim() || 'Live Event';
    const d = broadcast.direction;
    setCreating(true);
    try {
      await apiJson('/api/sessions', jsonBody({ event_name: name, source: d.source, target: d.target }));
      setEventName(name);
      writeLS('bt_event_name', name);
      writeLS('bt_event_code', EVENT_CODE);
      setHasSession(true);
    } catch (err) {
      toast(`Oturum oluşturulamadı: ${err instanceof Error ? err.message : ''}`, 'error');
    } finally {
      setCreating(false);
    }
  };

  const resetSession = () => {
    broadcast.stop();
    writeLS('bt_event_code', null);
    writeLS('bt_event_name', null);
    setEventName('');
    setHasSession(false);
  };

  if (!hasSession) {
    return (
      <Card className="max-w-xl">
        <CardHeader title="Yeni Yayın Oturumu" description="Etkinlik adını girip oturumu oluşturun. Katılımcılar QR kod ile katılır." />
        <form onSubmit={createSession} className="flex flex-col gap-4">
          <Input label="Etkinlik adı" placeholder="Örn. 2026 Açılış Töreni" value={eventName} onChange={setEventName} maxLength={255} autoFocus />
          <DirectionPicker directions={b.directions} index={b.directionIndex} />
          <Button type="submit" disabled={creating}>{creating ? 'Oluşturuluyor…' : 'Oturumu Oluştur'}</Button>
        </form>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <QrCard live={b.live} eventName={eventName} />

      <Card>
        <CardHeader
          title="Yayın Kontrolü"
          description={<>Konuşma tanıma için bu sayfayı <b>Chrome</b> veya <b>Edge</b>’de açın.</>}
        />
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-end gap-2">
              <Select
                aria-label="Mikrofon"
                className="min-w-0 flex-1"
                selectedKey={b.micId || '__default'}
                onSelectionChange={(k) => broadcast.selectMic(k === '__default' ? '' : String(k))}
              >
                <SelectItem id="__default">Varsayılan mikrofon</SelectItem>
                {b.mics.filter((m) => m.id && m.id !== 'default').map((m) => (
                  <SelectItem key={m.id} id={m.id}>{m.label}</SelectItem>
                ))}
              </Select>
              <Button variant="secondary" leadingIcon={RiMicLine} onClick={() => void broadcast.toggleMonitor()} disabled={b.running}>
                {b.monitoring ? 'Durdur' : 'Test'}
              </Button>
            </div>
            <span className="text-caption-1-regular text-text-tertiary">
              Seçim OpenAI motorunda ve test ölçerinde geçerlidir; DeepL motoru işletim sistemi varsayılan mikrofonunu kullanır.
            </span>
          </div>

          <div>
            <div className="mb-1.5 text-body-medium text-text-primary">Giriş seviyesi</div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-background-tertiary-default" role="meter" aria-label="Mikrofon seviyesi" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(b.level)}>
              <div className="h-full rounded-full bg-linear-to-r from-green-500 via-yellow-500 to-red-500 transition-[width] duration-75" style={{ width: `${b.level}%` }} />
            </div>
          </div>

          <DirectionPicker directions={b.directions} index={b.directionIndex} />

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-body-2-medium">
            <span className="inline-flex items-center gap-2 text-text-secondary">
              <StatusDot color={b.live ? 'green' : b.running ? 'yellow' : 'indigo'} />
              {b.statusText}
            </span>
            <TranslatorStatus engine={b.engine} state={b.translator} />
          </div>

          {b.running ? (
            <Button variant="danger" leadingIcon={RiStopCircleLine} onClick={() => broadcast.stop()} className="h-11">Yayını Durdur</Button>
          ) : (
            <Button leadingIcon={RiMicLine} onClick={() => broadcast.start()} className="h-11">Mikrofonu Başlat</Button>
          )}

          <div className="flex flex-wrap gap-2 border-t border-separator-border pt-4">
            <Button variant="secondary" size="small" leadingIcon={RiRefreshLine} onClick={async () => {
              try {
                const d = await apiJson<{ refreshed?: number }>(`/api/sessions/${EVENT_CODE}/refresh`, { method: 'POST' });
                toast(`${d.refreshed || 0} katılımcı ekranı yenilendi`, 'success');
              } catch (err) { toast(`Yenilenemedi: ${err instanceof Error ? err.message : ''}`, 'error'); }
            }}>Katılımcı ekranlarını yenile</Button>
            <Button variant="secondary" size="small" leadingIcon={RiDownload2Line} onClick={() => {
              download(`/api/history/export?date=${localDay()}&format=txt`).catch(() => toast('İndirilemedi', 'error'));
            }}>Bugünün dökümü (TXT)</Button>
            <Button variant="ghost" size="small" onClick={resetSession} disabled={b.running} className="ms-auto">Oturumu sıfırla</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function DirectionPicker({ directions, index }: { directions: Direction[]; index: number }) {
  const current = directions[index];
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-body-medium text-text-primary">Çeviri yönü</span>
      <SegmentedControl
        aria-label="Çeviri yönü"
        selectedKeys={current ? [current.id] : []}
        onSelectionChange={(keys) => {
          const id = [...keys][0];
          if (id) broadcast.selectDirection(String(id));
        }}
        className="self-start"
      >
        {directions.map((d) => <SegmentedControlItem key={d.id} id={d.id}>{d.label}</SegmentedControlItem>)}
      </SegmentedControl>
    </div>
  );
}

function TranslatorStatus({ engine, state }: { engine: 'deepl' | 'openai'; state: string }) {
  const name = engine === 'openai' ? 'OpenAI' : 'DeepL';
  const label = state === 'connected' ? 'Aktif' : state === 'reconnecting' ? 'Yeniden bağlanıyor…' : state === 'disconnected' ? 'Pasif' : 'Bekleniyor';
  return (
    <span className={cx(
      'inline-flex items-center gap-1.5',
      state === 'connected' ? 'text-green-700' : state === 'reconnecting' || state === 'disconnected' ? 'text-text-error-primary' : 'text-text-tertiary',
    )}>
      {name}: {label}
    </span>
  );
}

function QrCard({ live, eventName }: { live: boolean; eventName: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current) {
      void QRCode.toCanvas(canvasRef.current, participantUrl(), {
        width: 220, margin: 1, errorCorrectionLevel: 'H', color: { dark: '#1c1917', light: '#ffffff' },
      });
    }
  }, []);
  return (
    <section className={cx(
      'flex flex-col items-center rounded-3xl bg-linear-to-b from-neutral-900 to-neutral-800 p-6 text-center text-white shadow-card',
      live && 'ring-2 ring-accent-400 ring-offset-2 ring-offset-background-full',
    )}>
      <span className="text-caption-1-semibold tracking-[0.2em] text-neutral-400 uppercase">Katılımcı QR Kodu</span>
      <div className="mt-2 mb-4 truncate text-headline-semibold" title={eventName}>{eventName || 'Live Event'}</div>
      <div className="rounded-2xl bg-white p-3"><canvas ref={canvasRef} aria-label="Katılımcı sayfası QR kodu" /></div>
      <p className="mt-4 text-body-2-regular text-neutral-400">Bu QR’ı katılımcılarla paylaşın</p>
      <Button variant="secondary" size="small" className="mt-3" trailingIcon={RiExternalLinkLine}
        onClick={() => window.open(`/participant?code=${EVENT_CODE}`, '_blank', 'noopener')}>
        Katılımcı ekranını aç
      </Button>
    </section>
  );
}
