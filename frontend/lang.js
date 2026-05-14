const translations = {
  "en": {
    "nav_title": "B-Translate",
    "hero_title": "Communication <br> <span style='color: var(--text-primary);'>Without Borders.</span>",
    "hero_subtitle": "Instantly transcribe and translate your events and meetings using AI to multiple languages in real-time.",
    "card_host_title": "Start Broadcast",
    "card_host_desc": "Capture audio and broadcast to the server instantly. Manage the session via the dashboard.",
    "card_host_btn": "Log In as Host",
    "card_part_title": "Join as Participant",
    "card_part_desc": "Enter your event code and start reading real-time translations in your native language.",
    "card_part_btn": "Join",
    "placeholder_code": "Event Code",
    "feats_title": "Core System Features",
    "feat_1_title": "Ultra Low Latency (Real-Time)",
    "feat_1_desc": "Flawless text streaming via WebSockets with under 1 second end-to-end delay.",
    "feat_2_title": "Turkish & English Support",
    "feat_2_desc": "Participants can seamlessly switch between Turkish and English translations instantly.",
    "feat_3_title": "AI Powered (OpenAI Realtime)",
    "feat_3_desc": "High-accuracy speech recognition paired with context-aware semantic translations.",
    "feat_4_title": "Studio-Quality Audio (TTS)",
    "feat_4_desc": "Listen to translations read aloud with studio-quality AI voices powered by OpenAI.",
    "hiw_title": "How It Works",
    "hiw_s1_title": "Create a Session",
    "hiw_s1_desc": "The host logs in and creates a broadcast session. A unique QR code and event code are generated instantly.",
    "hiw_s2_title": "Start Broadcasting",
    "hiw_s2_desc": "Audio is captured as a raw PCM stream (16kHz mono) and streamed continuously to the server via WebSocket.",
    "hiw_s3_title": "AI Transcription",
    "hiw_s3_desc": "OpenAI's Realtime model listens, detects language, and translates speech automatically — zero hallucination, extremely low latency.",
    "hiw_s4_title": "Smart Translation",
    "hiw_s4_desc": "GPT-4o-mini translates each finalized transcript to every requested language with full context awareness.",
    "hiw_s5_title": "Voice Synthesis",
    "hiw_s5_desc": "OpenAI streams translated text and studio-quality audio directly to participants in real-time.",
    "hiw_s6_title": "Live Delivery",
    "hiw_s6_desc": "Participants receive both text and audio via WebSocket. They see and hear the translation the moment the speaker finishes a sentence.",
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
    "hero_title": "Sınırları Kaldıran <br> <span style='color: var(--text-primary);'>İletişim.</span>",
    "hero_subtitle": "Düzenlediğiniz etkinliklerde, toplantılarda veya yayınlarda sesinizi yapay zeka ile anında katılımcıların anadilinde metne dökün.",
    "card_host_title": "Yayın Başlat",
    "card_host_desc": "Sesi yakalayarak anında sunucuya iletin. Yönetim paneli üzerinden etkinliği koordine edin.",
    "card_host_btn": "Host Olarak Giriş Yap",
    "card_part_title": "Katılımcı Ol",
    "card_part_desc": "Size verilen etkinlik kodu ile katılarak anında anadilinizde çeviri okumaya başlayın.",
    "card_part_btn": "Katıl",
    "placeholder_code": "Oda Kodu",
    "feats_title": "Sistemin Öne Çıkan Özellikleri",
    "feat_1_title": "Ultra Düşük Gecikme",
    "feat_1_desc": "WebSocket üzerinden 1 saniyenin altında uçtan uca gecikme ile kusursuz metin akışı.",
    "feat_2_title": "Türkçe & İngilizce Desteği",
    "feat_2_desc": "Dinleyiciler Türkçe ve İngilizce dilleri arasında anında geçiş yaparak çevirileri takip edebilir.",
    "feat_3_title": "Yapay Zeka Gücü (OpenAI Realtime)",
    "feat_3_desc": "OpenAI GPT-Realtime modeli ile anında yüksek doğrulukta konuşma tanıma ve bağlam bilinçli çeviri.",
    "feat_4_title": "Stüdyo Kalitesinde Ses (TTS)",
    "feat_4_desc": "OpenAI ile çevirileri stüdyo kalitesinde yapay zeka sesleriyle anında dinleyin.",
    "hiw_title": "Nasıl Çalışır?",
    "hiw_s1_title": "Oturum Oluştur",
    "hiw_s1_desc": "Host giriş yapar ve bir yayın oturumu oluşturur. Anında benzersiz bir QR kod ve etkinlik kodu üretilir.",
    "hiw_s2_title": "Yayına Başla",
    "hiw_s2_desc": "Ses, ham PCM akışı (16kHz mono) olarak yakalanır ve WebSocket üzerinden sunucuya kesintisiz aktarılır.",
    "hiw_s3_title": "Yapay Zeka ile Yazıya Dökme",
    "hiw_s3_desc": "OpenAI Realtime modeli, konuşmayı dinler, dili anlar ve otomatik çevirir — sıfır halüsinasyon, çok düşük gecikme.",
    "hiw_s4_title": "Akıllı Çeviri",
    "hiw_s4_desc": "GPT-4o-mini, her tamamlanan transkripti istenen tüm dillere tam bağlam bilinciyle çevirir.",
    "hiw_s5_title": "Ses Sentezi",
    "hiw_s5_desc": "OpenAI, çevrilmiş metni ve stüdyo kalitesinde sesi anında katılımcılara ulaştırır.",
    "hiw_s6_title": "Canlı İletim",
    "hiw_s6_desc": "Katılımcılar hem metin hem de sesi WebSocket üzerinden alır. Konuşmacı cümlesini bitirir bitirmez çeviriyi görür ve duyarlar.",
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
