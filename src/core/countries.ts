export const countryNames: Record<string,string> = {};
const aliases = new Map<string,string>();
function normalize(value: string) { return value.trim().normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase(); }
for (let a=65;a<=90;a++) for(let b=65;b<=90;b++) {
  const code=String.fromCharCode(a,b);
  for (const locale of ['en','ru','uk']) {
    const name = new Intl.DisplayNames([locale],{type:'region',fallback:'none'}).of(code);
    if (name && name!==code) { aliases.set(normalize(name),code); if(locale==='en') countryNames[code]=name; }
  }
  if (countryNames[code]) aliases.set(normalize(code),code);
}
for (const [name,code] of Object.entries({'США':'US','USA':'US','U.S.A.':'US','United States of America':'US','Россия':'RU','Российская Федерация':'RU','Russia':'RU','СССР':'SU','USSR':'SU','Soviet Union':'SU','Югославия':'YU','Yugoslavia':'YU','Великобритания':'GB','Англия':'GB','UK':'GB','Great Britain':'GB','Южная Корея':'KR','Корея Южная':'KR','Корея (Южная)':'KR','South Korea':'KR','Северная Корея':'KP','North Korea':'KP'})) aliases.set(normalize(name),code);
countryNames.SU='Soviet Union';countryNames.YU='Yugoslavia';
export function countryCodes(value: string): string[] { return [...new Set(value.split(/[,;\/\n]/).flatMap(name=>aliases.get(normalize(name))?[aliases.get(normalize(name))!]:[]))]; }
