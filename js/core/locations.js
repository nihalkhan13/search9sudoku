/** Shared profile location choices for the browser and Vercel API. */

const COUNTRY_ROWS = `
United States (USA)|US
Afghanistan|AF
Albania|AL
Algeria|DZ
Andorra|AD
Angola|AO
Antigua and Barbuda|AG
Argentina|AR
Armenia|AM
Australia|AU
Austria|AT
Azerbaijan|AZ
Bahamas|BS
Bahrain|BH
Bangladesh|BD
Barbados|BB
Belarus|BY
Belgium|BE
Belize|BZ
Benin|BJ
Bhutan|BT
Bolivia|BO
Bosnia and Herzegovina|BA
Botswana|BW
Brazil|BR
Brunei|BN
Bulgaria|BG
Burkina Faso|BF
Burundi|BI
Cabo Verde|CV
Cambodia|KH
Cameroon|CM
Canada|CA
Central African Republic|CF
Chad|TD
Chile|CL
China|CN
Colombia|CO
Comoros|KM
Congo (Republic)|CG
Costa Rica|CR
Cote d'Ivoire|CI
Croatia|HR
Cuba|CU
Cyprus|CY
Czechia|CZ
Democratic Republic of the Congo|CD
Denmark|DK
Djibouti|DJ
Dominica|DM
Dominican Republic|DO
Ecuador|EC
Egypt|EG
El Salvador|SV
Equatorial Guinea|GQ
Eritrea|ER
Estonia|EE
Eswatini|SZ
Ethiopia|ET
Fiji|FJ
Finland|FI
France|FR
Gabon|GA
Gambia|GM
Georgia|GE
Germany|DE
Ghana|GH
Greece|GR
Grenada|GD
Guatemala|GT
Guinea|GN
Guinea-Bissau|GW
Guyana|GY
Haiti|HT
Honduras|HN
Hungary|HU
Iceland|IS
India|IN
Indonesia|ID
Iran|IR
Iraq|IQ
Ireland|IE
Israel|IL
Italy|IT
Jamaica|JM
Japan|JP
Jordan|JO
Kazakhstan|KZ
Kenya|KE
Kiribati|KI
Kuwait|KW
Kyrgyzstan|KG
Laos|LA
Latvia|LV
Lebanon|LB
Lesotho|LS
Liberia|LR
Libya|LY
Liechtenstein|LI
Lithuania|LT
Luxembourg|LU
Madagascar|MG
Malawi|MW
Malaysia|MY
Maldives|MV
Mali|ML
Malta|MT
Marshall Islands|MH
Mauritania|MR
Mauritius|MU
Mexico|MX
Micronesia|FM
Moldova|MD
Monaco|MC
Mongolia|MN
Montenegro|ME
Morocco|MA
Mozambique|MZ
Myanmar|MM
Namibia|NA
Nauru|NR
Nepal|NP
Netherlands|NL
New Zealand|NZ
Nicaragua|NI
Niger|NE
Nigeria|NG
North Korea|KP
North Macedonia|MK
Norway|NO
Oman|OM
Pakistan|PK
Palau|PW
Panama|PA
Papua New Guinea|PG
Paraguay|PY
Peru|PE
Philippines|PH
Poland|PL
Portugal|PT
Qatar|QA
Romania|RO
Russia|RU
Rwanda|RW
Saint Kitts and Nevis|KN
Saint Lucia|LC
Saint Vincent and the Grenadines|VC
Samoa|WS
San Marino|SM
Sao Tome and Principe|ST
Saudi Arabia|SA
Senegal|SN
Serbia|RS
Seychelles|SC
Sierra Leone|SL
Singapore|SG
Slovakia|SK
Slovenia|SI
Solomon Islands|SB
Somalia|SO
South Africa|ZA
South Korea|KR
South Sudan|SS
Spain|ES
Sri Lanka|LK
Sudan|SD
Suriname|SR
Sweden|SE
Switzerland|CH
Syria|SY
Taiwan|TW
Tajikistan|TJ
Tanzania|TZ
Thailand|TH
Timor-Leste|TL
Togo|TG
Tonga|TO
Trinidad and Tobago|TT
Tunisia|TN
Turkey|TR
Turkmenistan|TM
Tuvalu|TV
Uganda|UG
Ukraine|UA
United Arab Emirates|AE
United Kingdom|GB
Uruguay|UY
Uzbekistan|UZ
Vanuatu|VU
Vatican City|VA
Venezuela|VE
Vietnam|VN
Yemen|YE
Zambia|ZM
Zimbabwe|ZW
`.trim().split('\n').map((row) => {
  const [label, value] = row.split('|');
  return Object.freeze({ label, value });
});

export const COUNTRIES = Object.freeze(COUNTRY_ROWS);
export const DEFAULT_COUNTRY = 'US';

export const US_STATES = Object.freeze([
  ['Alabama', 'AL'], ['Alaska', 'AK'], ['Arizona', 'AZ'], ['Arkansas', 'AR'],
  ['California', 'CA'], ['Colorado', 'CO'], ['Connecticut', 'CT'], ['Delaware', 'DE'],
  ['District of Columbia', 'DC'], ['Florida', 'FL'], ['Georgia', 'GA'], ['Hawaii', 'HI'],
  ['Idaho', 'ID'], ['Illinois', 'IL'], ['Indiana', 'IN'], ['Iowa', 'IA'],
  ['Kansas', 'KS'], ['Kentucky', 'KY'], ['Louisiana', 'LA'], ['Maine', 'ME'],
  ['Maryland', 'MD'], ['Massachusetts', 'MA'], ['Michigan', 'MI'], ['Minnesota', 'MN'],
  ['Mississippi', 'MS'], ['Missouri', 'MO'], ['Montana', 'MT'], ['Nebraska', 'NE'],
  ['Nevada', 'NV'], ['New Hampshire', 'NH'], ['New Jersey', 'NJ'], ['New Mexico', 'NM'],
  ['New York', 'NY'], ['North Carolina', 'NC'], ['North Dakota', 'ND'], ['Ohio', 'OH'],
  ['Oklahoma', 'OK'], ['Oregon', 'OR'], ['Pennsylvania', 'PA'], ['Rhode Island', 'RI'],
  ['South Carolina', 'SC'], ['South Dakota', 'SD'], ['Tennessee', 'TN'], ['Texas', 'TX'],
  ['Utah', 'UT'], ['Vermont', 'VT'], ['Virginia', 'VA'], ['Washington', 'WA'],
  ['West Virginia', 'WV'], ['Wisconsin', 'WI'], ['Wyoming', 'WY'],
].map(([label, value]) => Object.freeze({ label, value })));

const COUNTRY_SET = new Set(COUNTRIES.map((country) => country.value));
const STATE_SET = new Set(US_STATES.map((state) => state.value));

export function normalizeLocation(country, state) {
  const cleanCountry = String(country ?? '').trim().toUpperCase();
  const cleanState = String(state ?? '').trim().toUpperCase();
  if (!COUNTRY_SET.has(cleanCountry)) return null;
  if (cleanCountry === DEFAULT_COUNTRY && !STATE_SET.has(cleanState)) return null;
  return { country: cleanCountry, state: cleanCountry === DEFAULT_COUNTRY ? cleanState : null };
}
