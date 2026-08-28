const translations = {
  "en": {
    "nav_title": "B-Translate",
    "hero_eyebrow": "Beykoz University · Live Translation",
    "hero_title": "Communication <span class='grad-text'>Without Borders.</span>",
    "hero_subtitle": "Instantly transcribe and translate your live events with AI — in real-time, with the lowest possible latency.",
    "hero_note_secure": "API key stays on the server",
    "hero_note_latency": "Sub-second delivery",
    "hero_note_vad": "Silence & noise filtered",
    "pv_live": "Live Feed",
    "pv_listening": "Listening",
    "pv_connected": "DeepL connected",
    "pv_audio": "Translated audio",
    "stat_latency": "End-to-end latency",
    "stat_langs": "Two-way, one-tap switch",
    "stat_secure": "Server-side API key",
    "card_host_title": "Start Broadcast",
    "card_host_desc": "Capture audio and broadcast to the server instantly. Manage the session via the dashboard.",
    "card_host_btn": "Log In as Host",
    "card_part_title": "Join as Participant",
    "card_part_desc": "Enter your event code and start reading real-time translations in your native language.",
    "card_part_btn": "Join Event",
    "no_live_note": "No live broadcast right now. A host can start one from the host login.",
    "placeholder_code": "Event Code",
    "feats_title": "Built for live events",
    "feats_sub": "Everything the stage needs — accurate, fast, and quiet when the room is quiet.",
    "feat_1_title": "Voice Activity Detection",
    "feat_1_desc": "Only real speech is streamed. Silence, music, applause and mic noise are filtered out before they can cause hallucinations.",
    "feat_2_title": "Ultra-low latency",
    "feat_2_desc": "A lean WebSocket pipeline streams transcript and translation the moment words are spoken.",
    "feat_3_title": "TR ⇄ EN, one tap",
    "feat_3_desc": "Switch direction instantly. The language layer is central, so more languages drop in easily.",
    "feat_4_title": "Translated audio",
    "feat_4_desc": "Optional spoken translation with its own volume & mute — a gap-free playback queue.",
    "feat_5_title": "Session transcripts",
    "feat_5_desc": "Every finalized segment is saved and exportable as TXT, CSV or JSON after the event.",
    "hiw_title": "How It Works",
    "hiw_sub": "From the speaker's mic to the audience's screen in three steps.",
    "hiw_s1_title": "Start a session",
    "hiw_s1_desc": "The host logs in, picks a direction, and shares a QR code. Participants join in one tap.",
    "hiw_s2_title": "Speak naturally",
    "hiw_s2_desc": "The browser recognizes speech and sends each phrase to the server, which translates it with DeepL.",
    "hiw_s3_title": "Read & hear",
    "hiw_s3_desc": "Participants see live transcript and translation — and, when enabled, hear it aloud.",
    "cta_title": "Ready for your next event?",
    "cta_desc": "Join a live session as a participant, or log in as a host to start broadcasting.",
    "cta_btn": "Join Live Event",
    "cta_host": "Log In as Host",
    "footer_copy": "B-Translate | Licensed under CC BY-NC-SA 4.0 — Beykoz University IT Directorate",
    
    // Host Panel
    "host_login_title": "Host Login",
    "lbl_username": "Username",
    "lbl_password": "Password",
    "btn_login": "Login",
    "host_dash_title": "Host Dashboard",
    "lbl_event_name_placeholder": "E.g., Q3 Global Townhall",
    "btn_new_session": "New Session",
    "btn_download_history": "Download History",
    "btn_usermgmt": "User Mgmt",
    "btn_logout": "Logout",
    "setup_subtitle": "Create a new broadcast session",
    "btn_gen_code": "Generate Event Code",
    "lbl_event_code": "YOUR EVENT CODE",
    "lbl_share_code": "Share this code with participants",
    "btn_start_mic": "Start Microphone",
    "btn_stop_mic": "Stop Broadcast",
    "status_ready": "Status: Ready to broadcast",
    "status_broadcasting": "Status: Broadcasting 🔴",
    "status_error": "Status: Connection Error",
    "status_stopped": "Status: Broadcast Stopped",
    
    // Admin Modal
    "admin_title": "User Management",
    "btn_add": "Add User",
    "btn_del": "Del",
    "btn_upd": "Change Pwd",
    
    // Participant Feed
    "part_feed_title": "Live Feed",
    "status_disconnected": "Disconnected",
    "status_connected": "Connected to",
    "status_reconnecting": "Reconnecting…",
    "waiting_msg": "Waiting for transmission...",
    "disclaimer": "⚠️ This is an AI-powered translation system. Transcriptions and translations are generated automatically and may contain errors. If you experience freezing or technical issues, please refresh the page.",
    "mode_title": "How would you like to participate?",
    "mode_text": "Read Text",
    "mode_audio": "Listen Aloud",
    "mode_desc": "Listen mode will read the translated subtitles aloud as they arrive.",
    "lbl_audio_enabled": "Audio Enabled",
    "btn_play": "Play",
    "btn_stop": "Stop",
    "btn_audio_on": "Audio On",
    "btn_audio_off": "Audio Off",
    "btn_tv_mode": "TV Mode",
    "toast_audio_title": "Enable Audio Narration?",
    "toast_audio_desc": "Translations can be read aloud as they arrive. You can mute anytime.",
    "toast_audio_warn": "Make sure your headphones are on before enabling audio to avoid disturbing others.",
    "toast_btn_enable": "Enable Audio",
    "toast_btn_dismiss": "No Thanks"
  },
  "tr": {
    "nav_title": "B-Translate",
    "hero_eyebrow": "Beykoz Üniversitesi · Canlı Çeviri",
    "hero_title": "Sınırları Kaldıran <span class='grad-text'>İletişim.</span>",
    "hero_subtitle": "Canlı etkinliklerinizi yapay zeka ile anında yazıya dökün ve çevirin — gerçek zamanlı, mümkün olan en düşük gecikmeyle.",
    "hero_note_secure": "API anahtarı sunucuda kalır",
    "hero_note_latency": "Saniye altı iletim",
    "hero_note_vad": "Sessizlik ve gürültü elenir",
    "pv_live": "Canlı Akış",
    "pv_listening": "Dinleniyor",
    "pv_connected": "DeepL bağlı",
    "pv_audio": "Sesli çeviri",
    "stat_latency": "Uçtan uca gecikme",
    "stat_langs": "Çift yönlü, tek tuş",
    "stat_secure": "Sunucu tarafı API anahtarı",
    "card_host_title": "Yayın Başlat",
    "card_host_desc": "Sesi yakalayarak anında sunucuya iletin. Yönetim paneli üzerinden etkinliği koordine edin.",
    "card_host_btn": "Host Olarak Giriş Yap",
    "card_part_title": "Katılımcı Ol",
    "card_part_desc": "Size verilen etkinlik kodu ile katılarak anında anadilinizde çeviri okumaya başlayın.",
    "card_part_btn": "Etkinliğe Katıl",
    "no_live_note": "Şu anda canlı yayın yok. Host, giriş ekranından yayın başlatabilir.",
    "placeholder_code": "Oda Kodu",
    "feats_title": "Canlı etkinlikler için tasarlandı",
    "feats_sub": "Sahnenin ihtiyacı olan her şey — doğru, hızlı ve salon sessizken sessiz.",
    "feat_1_title": "Konuşma Algılama (VAD)",
    "feat_1_desc": "Yalnızca gerçek konuşma iletilir. Sessizlik, müzik, alkış ve mikrofon gürültüsü, halüsinasyona yol açmadan elenir.",
    "feat_2_title": "Ultra düşük gecikme",
    "feat_2_desc": "Yalın bir WebSocket hattı, kelimeler söylenir söylenmez transkript ve çeviriyi akıtır.",
    "feat_3_title": "TR ⇄ EN, tek tuş",
    "feat_3_desc": "Yönü anında değiştirin. Dil katmanı merkezî olduğu için yeni diller kolayca eklenir.",
    "feat_4_title": "Sesli çeviri",
    "feat_4_desc": "İsteğe bağlı sesli çeviri; kendi ses seviyesi ve sessize alma kontrolüyle, boşluksuz bir oynatma kuyruğu.",
    "feat_5_title": "Oturum transkriptleri",
    "feat_5_desc": "Kesinleşen her segment kaydedilir ve etkinlik sonunda TXT, CSV veya JSON olarak dışa aktarılabilir.",
    "hiw_title": "Nasıl Çalışır?",
    "hiw_sub": "Konuşmacının mikrofonundan izleyicinin ekranına üç adımda.",
    "hiw_s1_title": "Oturum başlat",
    "hiw_s1_desc": "Host giriş yapar, yönü seçer ve bir QR kod paylaşır. Katılımcılar tek dokunuşla katılır.",
    "hiw_s2_title": "Doğal konuş",
    "hiw_s2_desc": "Tarayıcı konuşmayı tanır ve her cümleyi sunucuya iletir; sunucu DeepL ile çevirir.",
    "hiw_s3_title": "Oku ve dinle",
    "hiw_s3_desc": "Katılımcılar canlı transkript ve çeviriyi görür — etkinse sesli olarak da duyar.",
    "cta_title": "Bir sonraki etkinliğinize hazır mısınız?",
    "cta_desc": "Katılımcı olarak canlı bir oturuma katılın ya da host olarak giriş yapıp yayına başlayın.",
    "cta_btn": "Canlı Etkinliğe Katıl",
    "cta_host": "Host Olarak Giriş Yap",
    "footer_copy": "B-Translate | CC BY-NC-SA 4.0 Lisansı ile lisanslanmıştır — Beykoz Üniversitesi Bilgi İşlem Direktörlüğü",
    
    // Host Panel
    "host_login_title": "Host Girişi",
    "lbl_username": "Kullanıcı Adı",
    "lbl_password": "Şifre",
    "btn_login": "Giriş Yap",
    "host_dash_title": "Host Paneli",
    "lbl_event_name_placeholder": "Örn: 2026 Global Buluşma",
    "btn_usermgmt": "Kullanıcı Yönetimi",
    "btn_logout": "Çıkış",
    "btn_new_session": "Yeni Oturum",
    "btn_download_history": "Geçmişi İndir",
    "setup_subtitle": "Yeni bir yayın oturumu başlatın",
    "btn_gen_code": "Etkinlik Kodu Oluştur",
    "lbl_event_code": "ETKİNLİK KODUNUZ",
    "lbl_share_code": "Bu kodu katılımcılarla paylaşın",
    "btn_start_mic": "Mikrofonu Başlat",
    "btn_stop_mic": "Yayını Durdur",
    "status_ready": "Durum: Yayına hazır",
    "status_broadcasting": "Durum: Yayında 🔴",
    "status_error": "Durum: Bağlantı Hatası",
    "status_stopped": "Durum: Yayın Durduruldu",
    
    // Admin Modal
    "admin_title": "Kullanıcı Yönetimi",
    "btn_add": "Ekle",
    "btn_del": "Sil",
    "btn_upd": "Şifre Değiştir",
    
    // Participant Feed
    "part_feed_title": "Canlı Akış",
    "status_disconnected": "Bağlantı Bekleniyor",
    "status_connected": "Bağlanıldı:",
    "status_reconnecting": "Bağlantı yeniden kuruluyor…",
    "waiting_msg": "Yayın bekleniyor...",
    "disclaimer": "⚠️ Bu sistem yapay zeka ile desteklenmektedir. Çeviriler otomatik olarak oluşturulduğundan anlamsal hatalar içerebilir. Eğer donma veya benzeri teknik bir sorun yaşarsanız sayfayı yenileyin.",
    "mode_title": "Deneyiminizi nasıl seçmek istersiniz?",
    "mode_text": "Yazılı Oku",
    "mode_audio": "Sesli Dinle",
    "mode_desc": "Sesli mod, konuşmacının cümleleri çevrildikçe seçtiğiniz dilde size okunmasını sağlar.",
    "lbl_audio_enabled": "Sesli Okuma Açık",
    "btn_play": "Oynat",
    "btn_stop": "Durdur",
    "btn_audio_on": "Ses Açık",
    "btn_audio_off": "Ses Kapalı",
    "btn_tv_mode": "TV Modu",
    "toast_audio_title": "Sesli Çeviriyi Açılsın mı?",
    "toast_audio_desc": "Yayın geldikçe çeviriler size sesli olarak okunabilir. Ses seviyesini istediğiniz zaman kapatabilirsiniz.",
    "toast_audio_warn": "Sesi etkinleştirmeden önce kulaklığınızı taktığınıza emin olun; aksi halde çevre sesız rahatsız edebilir.",
    "toast_btn_enable": "Sesi Aç",
    "toast_btn_dismiss": "Hayır, Teşekkürler"
  }
};

function changeSiteLanguage(lang) {
  localStorage.setItem('bt_lang', lang);
  
  // Set active class on lang toggles (if they exist)
  document.querySelectorAll('.lang-toggle').forEach(el => {
    el.style.opacity = '0.5';
    el.style.fontWeight = 'normal';
    if(el.dataset.lang === lang) {
      el.style.opacity = '1';
      el.style.fontWeight = 'bold';
    }
  });

  const dict = translations[lang];
  if(!dict) return;

  // Update innerHTML
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (dict[key]) {
      el.innerHTML = dict[key];
    }
  });
  
  // Update placeholders
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (dict[key]) {
      el.placeholder = dict[key];
    }
  });
}

// Initialization on load
document.addEventListener('DOMContentLoaded', () => {
  const savedLang = localStorage.getItem('bt_lang') || 'en';
  changeSiteLanguage(savedLang);
});
