'use strict';

/**
 * Central language configuration.
 *
 * Adding a new language is a one-line change here — nothing is hardcoded to
 * two languages anywhere else in the codebase. `deeplCode` maps our internal
 * code to whatever code the DeepL Voice API expects for that language.
 */
const LANGUAGES = {
  tr: { code: 'tr', deeplCode: 'TR', label: 'Türkçe', labelEn: 'Turkish', flag: '🇹🇷', rtl: false },
  en: { code: 'en', deeplCode: 'EN', label: 'English', labelEn: 'English', flag: '🇬🇧', rtl: false },
};

// Supported translation directions (source -> target). Toggled by the host.
const DIRECTIONS = [
  { id: 'tr-en', source: 'tr', target: 'en', label: 'Türkçe → İngilizce' },
  { id: 'en-tr', source: 'en', target: 'tr', label: 'İngilizce → Türkçe' },
];

/**
 * Domain glossary / terminology. If the DeepL Voice account exposes glossary
 * support, these pairs are sent with the session so university-specific terms
 * are translated consistently. Kept central so it is easy to extend.
 */
const GLOSSARY = {
  'tr-en': {
    'Beykoz Üniversitesi': 'Beykoz University',
    'Yükseköğretim Kurulu': 'Council of Higher Education',
    'Mütevelli Heyeti': 'Board of Trustees',
    'Rektörlük': "Rector's Office",
    'Fakülte': 'Faculty',
    'Enstitü': 'Institute',
    'Lisans': 'Undergraduate',
    'Lisansüstü': 'Graduate',
    'Akademik yıl': 'Academic year',
    'Uluslararasılaşma': 'Internationalization',
    'Yapay zekâ': 'Artificial intelligence',
    'Bilgisayar Mühendisliği': 'Computer Engineering',
    'Yazılım Mühendisliği': 'Software Engineering',
  },
  'en-tr': {
    'Beykoz University': 'Beykoz Üniversitesi',
    'Council of Higher Education': 'Yükseköğretim Kurulu',
    'Board of Trustees': 'Mütevelli Heyeti',
    'Faculty': 'Fakülte',
    'Institute': 'Enstitü',
    'Undergraduate': 'Lisans',
    'Graduate': 'Lisansüstü',
    'Academic year': 'Akademik yıl',
    'Internationalization': 'Uluslararasılaşma',
    'Artificial intelligence': 'Yapay zekâ',
    'Computer Engineering': 'Bilgisayar Mühendisliği',
    'Software Engineering': 'Yazılım Mühendisliği',
  },
};

function isValidLanguage(code) {
  return Object.prototype.hasOwnProperty.call(LANGUAGES, code);
}

function getDirection(id) {
  return DIRECTIONS.find((d) => d.id === id);
}

function resolveDirection(source, target) {
  return DIRECTIONS.find((d) => d.source === source && d.target === target);
}

module.exports = {
  LANGUAGES,
  DIRECTIONS,
  GLOSSARY,
  isValidLanguage,
  getDirection,
  resolveDirection,
};
