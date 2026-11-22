'use strict';
// Определение страны ключа по флагу или названию + русские названия стран.

const RU = {
  US: 'США', PL: 'Польша', DE: 'Германия', NL: 'Нидерланды', FI: 'Финляндия', EE: 'Эстония', FR: 'Франция',
  GB: 'Великобритания', SE: 'Швеция', TR: 'Турция', KZ: 'Казахстан', RU: 'Россия', LV: 'Латвия', LT: 'Литва',
  AT: 'Австрия', CH: 'Швейцария', CZ: 'Чехия', IT: 'Италия', ES: 'Испания', JP: 'Япония', SG: 'Сингапур',
  HK: 'Гонконг', AE: 'ОАЭ', CA: 'Канада', UA: 'Украина', MD: 'Молдова', RO: 'Румыния', BG: 'Болгария',
  HU: 'Венгрия', NO: 'Норвегия', DK: 'Дания', IL: 'Израиль', KR: 'Южная Корея', IN: 'Индия', BR: 'Бразилия',
  AM: 'Армения', GE: 'Грузия', AZ: 'Азербайджан', BY: 'Беларусь', RS: 'Сербия', IE: 'Ирландия', BE: 'Бельгия',
  PT: 'Португалия', GR: 'Греция', HR: 'Хорватия', SK: 'Словакия', SI: 'Словения', IS: 'Исландия', LU: 'Люксембург',
  CY: 'Кипр', MT: 'Мальта', AU: 'Австралия', NZ: 'Новая Зеландия', MX: 'Мексика', AR: 'Аргентина', CN: 'Китай',
  TW: 'Тайвань', VN: 'Вьетнам', TH: 'Таиланд', MY: 'Малайзия', ID: 'Индонезия', PH: 'Филиппины', ZA: 'ЮАР',
  EG: 'Египет', SA: 'Саудовская Аравия', QA: 'Катар', UZ: 'Узбекистан', KG: 'Киргизия', TJ: 'Таджикистан',
  MN: 'Монголия', AL: 'Албания', MK: 'Северная Македония', BA: 'Босния', ME: 'Черногория', CL: 'Чили', CO: 'Колумбия',
};

// Слова в названии → код страны (рус/англ, без флага)
const WORDS = {
  US: ['сша', 'usa', 'united states', 'америка', 'america', 'нью-йорк', 'new york'], PL: ['польша', 'poland', 'варшава', 'warsaw'],
  DE: ['германия', 'germany', 'франкфурт', 'frankfurt', 'deutschland'], NL: ['нидерланды', 'netherlands', 'голландия', 'holland', 'амстердам', 'amsterdam'],
  FI: ['финляндия', 'finland', 'хельсинки', 'helsinki'], EE: ['эстония', 'estonia', 'таллин', 'tallinn'], FR: ['франция', 'france', 'париж', 'paris'],
  GB: ['великобритания', 'британия', 'англия', 'united kingdom', 'england', 'london', 'лондон', ' uk'], SE: ['швеция', 'sweden', 'стокгольм'],
  TR: ['турция', 'turkey', 'türkiye', 'стамбул', 'istanbul'], KZ: ['казахстан', 'kazakhstan', 'алматы', 'almaty'], RU: ['россия', 'russia', 'москва', 'moscow'],
  LV: ['латвия', 'latvia', 'рига', 'riga'], LT: ['литва', 'lithuania', 'вильнюс'], AT: ['австрия', 'austria', 'вена', 'vienna'],
  CH: ['швейцария', 'switzerland', 'цюрих', 'zurich'], CZ: ['чехия', 'czech', 'прага', 'prague'], IT: ['италия', 'italy', 'милан', 'milan'],
  ES: ['испания', 'spain', 'мадрид', 'madrid'], JP: ['япония', 'japan', 'токио', 'tokyo'], SG: ['сингапур', 'singapore'],
  HK: ['гонконг', 'hong kong'], AE: ['оаэ', 'uae', 'emirates', 'дубай', 'dubai'], CA: ['канада', 'canada'], UA: ['украина', 'ukraine'],
  MD: ['молдова', 'moldova'], RO: ['румыния', 'romania'], BG: ['болгария', 'bulgaria'], HU: ['венгрия', 'hungary'], NO: ['норвегия', 'norway'],
  DK: ['дания', 'denmark'], IL: ['израиль', 'israel'], KR: ['корея', 'korea'], IN: ['индия', 'india'], AM: ['армения', 'armenia'],
  GE: ['грузия', 'georgia'], RS: ['сербия', 'serbia'], IE: ['ирландия', 'ireland'], BE: ['бельгия', 'belgium'], PT: ['португалия', 'portugal'],
  GR: ['греция', 'greece'], AU: ['австралия', 'australia'],
};

function flag(code) {
  if (!/^[A-Z]{2}$/.test(code)) return '🌐';
  return String.fromCodePoint(...[...code].map((c) => 0x1F1E6 + c.charCodeAt(0) - 65));
}

function countryOf(name) {
  const s = String(name || '');
  const m = s.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u);
  if (m) {
    const code = [...m[0]].map((c) => String.fromCharCode(c.codePointAt(0) - 0x1F1E6 + 65)).join('');
    return code === 'UK' ? 'GB' : code;
  }
  const low = ` ${s.toLowerCase()} `;
  for (const [code, words] of Object.entries(WORDS)) if (words.some((w) => low.includes(w))) return code;
  return 'XX';
}

function groupName(code) {
  if (code === 'XX') return '🌐 Другие';
  return `${flag(code)} ${RU[code] || code}`;
}

module.exports = { countryOf, groupName, flag };
