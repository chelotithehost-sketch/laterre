/* i18n.js — UI strings + plain-language rules (TERRA_MASTER_SPEC.md §6.11).
   Ships English plus a starter set; machine-drafted strings are marked
   needs_review so the community can correct them via pull requests.
   Country names come from REST Countries translations (not this file). */
(function () {
  const STRINGS = {
    en: {
      search_placeholder: 'Ask anything — a place, a website, “time in Tokyo”…',
      home_title: 'What do you need today?', back_home: '⌂ Home',
      simple: 'Simple', pro: 'Pro', plain: 'In plain English:',
      loading: 'One moment…', offline_chip: 'offline', needs_review: false
    },
    es: {
      search_placeholder: 'Pregunta lo que sea — un lugar, una web, “hora en Tokio”…',
      home_title: '¿Qué necesitas hoy?', back_home: '⌂ Inicio',
      simple: 'Sencillo', pro: 'Pro', plain: 'En palabras sencillas:',
      loading: 'Un momento…', offline_chip: 'sin conexión', needs_review: true
    },
    fr: {
      search_placeholder: 'Demandez tout — un lieu, un site, “heure à Tokyo”…',
      home_title: 'De quoi avez-vous besoin aujourd’hui ?', back_home: '⌂ Accueil',
      simple: 'Simple', pro: 'Pro', plain: 'En clair :',
      loading: 'Un instant…', offline_chip: 'hors ligne', needs_review: true
    },
    ar: {
      search_placeholder: 'اسأل عن أي شيء — مكان، موقع، “التوقيت في طوكيو”…',
      home_title: 'ماذا تحتاج اليوم؟', back_home: '⌂ الرئيسية',
      simple: 'بسيط', pro: 'احترافي', plain: 'ببساطة:',
      loading: 'لحظة…', offline_chip: 'غير متصل', needs_review: true
    },
    zh: {
      search_placeholder: '随便问 — 地点、网站、“东京时间”…',
      home_title: '今天需要什么？', back_home: '⌂ 首页',
      simple: '简单', pro: '专业', plain: '简单来说：',
      loading: '稍等…', offline_chip: '离线', needs_review: true
    }
  };

  /* RTL: Arabic is laid out right-to-left */
  const RTL = ['ar'];
  const nav = (navigator.language || 'en').toLowerCase();
  const lang = Object.keys(STRINGS).find(l => nav.startsWith(l)) || 'en';

  window.I18N = {
    lang,
    t(key) {
      const s = STRINGS[lang] || STRINGS.en;
      return s[key] != null ? s[key] : (STRINGS.en[key] || key);
    },
    strings: STRINGS,
    needsReview: !!(STRINGS[lang] && STRINGS[lang].needs_review),
    rtl: RTL.includes(lang)
  };
  if (I18N.rtl) document.documentElement.dir = 'rtl';
})();
