import { useEffect, useState } from 'react';
import { RiRestartLine } from '@remixicon/react';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Select, SelectItem } from '@/components/base/select/select';
import { Switch } from '@/components/base/switch/switch';
import { apiJson, jsonBody, type Settings } from '@/lib/api';
import { broadcast } from '@/lib/broadcast';
import { Card, CardHeader, Dialog, useToast } from '../ui';

const DEFAULTS: Settings = { voice_engine: 'deepl', flush_on_punctuation: true, max_words: 12, silence_ms: 500 };

export function SettingsView() {
  const toast = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [maxWords, setMaxWords] = useState('12');
  const [silence, setSilence] = useState('500');
  const [saving, setSaving] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);

  const apply = (cfg: Settings) => {
    setS(cfg);
    setMaxWords(String(cfg.max_words));
    setSilence(String(cfg.silence_ms));
    broadcast.setFlushConfig(cfg); // also applies to a broadcast running in this tab
  };

  useEffect(() => {
    apiJson<Settings>('/api/settings').then(apply).catch(() => toast('Ayarlar yüklenemedi', 'error'));
  }, [toast]);

  const save = async () => {
    if (!s) return;
    setSaving(true);
    try {
      const body = { ...s, max_words: parseInt(maxWords, 10) || 0, silence_ms: parseInt(silence, 10) || 500 };
      apply(await apiJson<Settings>('/api/settings', jsonBody(body, 'PUT')));
      toast('Ayarlar kaydedildi', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Kaydedilemedi', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!s) return <Card><p className="text-body-regular text-text-tertiary">Yükleniyor…</p></Card>;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Card>
        <CardHeader title="Çeviri Motoru" description="Sesli konuşmanın nasıl işleneceğini seçin. Değişiklik, sonraki yayın başlatıldığında geçerli olur." />
        <div className="flex flex-col gap-1.5">
          <span className="text-body-medium text-text-primary">Motor</span>
          <Select aria-label="Motor" selectedKey={s.voice_engine} className="max-w-md"
            onSelectionChange={(k) => setS({ ...s, voice_engine: k === 'openai' ? 'openai' : 'deepl' })}>
            <SelectItem id="deepl">DeepL (tarayıcı tanıma + metin çeviri) — varsayılan</SelectItem>
            <SelectItem id="openai">OpenAI realtime (sunucu ses çevirisi)</SelectItem>
          </Select>
        </div>
        <ul className="mt-4 flex list-disc flex-col gap-1.5 ps-5 text-body-2-regular text-text-secondary">
          <li><b className="text-text-primary">DeepL:</b> Konuşma tanıma host tarayıcısında (Chrome/Edge). Katılımcı sesi cihazın kendi TTS’i ile.</li>
          <li><b className="text-text-primary">OpenAI:</b> Ses sunucuda çevrilir; çevrilmiş gerçek ses katılımcıya akıtılır (mobilde de çalışır). Kaynak dili otomatik algılar. OPENAI_API_KEY gerekir; dakika başı ücretlidir.</li>
        </ul>
      </Card>

      <Card>
        <CardHeader
          title="Çeviri Segmentleme"
          description="Konuşmanın ne zaman bir cümle olarak kapatılıp çeviriye gönderileceğini belirler (yalnızca DeepL motoru). Daha erken kapatma = daha hızlı ama daha kısa parçalar."
        />
        <div className="flex flex-col gap-5">
          <Switch isSelected={s.flush_on_punctuation} onChange={(v) => setS({ ...s, flush_on_punctuation: v })}>
            Cümle sonu noktalamasında kapat ( . ! ? … )
          </Switch>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Maksimum kelime" type="number" inputMode="numeric" value={maxWords} onChange={setMaxWords} hint="0 = kapalı (0–60)" />
            <Input label="Sessizlik eşiği (ms)" type="number" inputMode="numeric" value={silence} onChange={setSilence} hint="Duraklamada kapat (200–5000)" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save()} disabled={saving}>Kaydet</Button>
            <Button variant="secondary" onClick={() => apply({ ...DEFAULTS, voice_engine: s.voice_engine })}>Varsayılana dön</Button>
          </div>
          <p className="text-caption-1-regular text-text-tertiary">Bu ayarlar sunucuda saklanır ve tüm yayın ekranlarına uygulanır.</p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Sunucu" description="Uygulamayı yeniden başlatır (systemd/PM2 birkaç saniye içinde tekrar ayağa kaldırır). Aktif yayın ve bağlantılar kısa süre kesilir." />
        <Button variant="danger" leadingIcon={RiRestartLine} onClick={() => setRestartOpen(true)}>Servisi Yeniden Başlat</Button>
      </Card>

      <Dialog
        isOpen={restartOpen} onClose={() => setRestartOpen(false)} danger submitLabel="Yeniden Başlat"
        title="Servis yeniden başlatılsın mı?" description="Aktif yayın birkaç saniye kesilir; katılımcılar otomatik olarak yeniden bağlanır."
        onSubmit={async () => {
          await apiJson('/api/system/restart', { method: 'POST' });
          toast('Yeniden başlatılıyor… ~5 sn', 'success');
        }}
      />
    </div>
  );
}
