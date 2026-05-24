import type { Fixture, Stadium } from '../types.js';

// ── Stadiums ──────────────────────────────────────────────────────────────────

const S: Record<string, Stadium> = {
  METLIFE:   { name: 'MetLife Stadium',         city: 'East Rutherford, NJ', country: 'USA',    capacity: 82_500 },
  ROSE_BOWL: { name: 'Rose Bowl Stadium',        city: 'Pasadena, CA',        country: 'USA',    capacity: 88_565 },
  ATANDT:    { name: 'AT&T Stadium',             city: 'Arlington, TX',       country: 'USA',    capacity: 80_000 },
  SOFI:      { name: 'SoFi Stadium',             city: 'Inglewood, CA',       country: 'USA',    capacity: 70_240 },
  LEVIS:     { name: "Levi's Stadium",           city: 'Santa Clara, CA',     country: 'USA',    capacity: 68_500 },
  ARROWHEAD: { name: 'Arrowhead Stadium',        city: 'Kansas City, MO',     country: 'USA',    capacity: 76_416 },
  ALLEGIANT: { name: 'Allegiant Stadium',        city: 'Las Vegas, NV',       country: 'USA',    capacity: 65_000 },
  NRG:       { name: 'NRG Stadium',              city: 'Houston, TX',         country: 'USA',    capacity: 72_220 },
  MB_ATL:    { name: 'Mercedes-Benz Stadium',    city: 'Atlanta, GA',         country: 'USA',    capacity: 75_000 },
  GILLETTE:  { name: 'Gillette Stadium',         city: 'Foxborough, MA',      country: 'USA',    capacity: 65_878 },
  LINCOLN:   { name: 'Lincoln Financial Field',  city: 'Philadelphia, PA',    country: 'USA',    capacity: 69_328 },
  LUMEN:     { name: 'Lumen Field',              city: 'Seattle, WA',         country: 'USA',    capacity: 68_740 },
  AZTECA:    { name: 'Estadio Azteca',           city: 'Mexico City',         country: 'Mexico', capacity: 87_523 },
  BBVA:      { name: 'Estadio BBVA',             city: 'Monterrey',           country: 'Mexico', capacity: 51_348 },
  AKRON:     { name: 'Estadio Akron',            city: 'Guadalajara',         country: 'Mexico', capacity: 49_850 },
  BC_PLACE:  { name: 'BC Place',                 city: 'Vancouver',           country: 'Canada', capacity: 54_500 },
  BMO_FIELD: { name: 'BMO Field',                city: 'Toronto',             country: 'Canada', capacity: 45_000 },
};

// ── Teams ─────────────────────────────────────────────────────────────────────

const T = {
  BRA: { name: 'Brazil',        code: 'BRA', flag: '🇧🇷', iso: 'br', players: ['Vinicius Jr', 'Rodrygo', 'Paquetá', 'Endrick', 'Savinho', 'Bruno Guimarães', 'Marquinhos', 'Militão'] },
  FRA: { name: 'France',        code: 'FRA', flag: '🇫🇷', iso: 'fr', players: ['Mbappé', 'Griezmann', 'Thuram', 'Dembélé', 'Camavinga', 'Tchouaméni', 'Saliba', 'Upamecano'] },
  ARG: { name: 'Argentina',     code: 'ARG', flag: '🇦🇷', iso: 'ar', players: ['Messi', 'Lautaro Martínez', 'Di María', 'Mac Allister', 'De Paul', 'Fernández', 'Otamendi', 'Molina'] },
  ENG: { name: 'England',       code: 'ENG', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', iso: 'gb-eng', players: ['Bellingham', 'Kane', 'Saka', 'Foden', 'Alexander-Arnold', 'Rice', 'Walker', 'Stones'] },
  ESP: { name: 'Spain',         code: 'ESP', flag: '🇪🇸', iso: 'es', players: ['Yamal', 'Nico Williams', 'Pedri', 'Rodri', 'Morata', 'Gavi', 'Carvajal', 'Le Normand'] },
  POR: { name: 'Portugal',      code: 'POR', flag: '🇵🇹', iso: 'pt', players: ['Ronaldo', 'Félix', 'Leão', 'Bernardo Silva', 'Vitinha', 'Neves', 'Rúben Dias', 'Cancelo'] },
  GER: { name: 'Germany',       code: 'GER', flag: '🇩🇪', iso: 'de', players: ['Musiala', 'Wirtz', 'Havertz', 'Kimmich', 'Gündogan', 'Gnabry', 'Rüdiger', 'Schlotterbeck'] },
  NED: { name: 'Netherlands',   code: 'NED', flag: '🇳🇱', iso: 'nl', players: ['Gakpo', 'van Dijk', 'de Jong', 'Reijnders', 'Depay', 'Dumfries', 'de Ligt', 'Veerman'] },
  BEL: { name: 'Belgium',       code: 'BEL', flag: '🇧🇪', iso: 'be', players: ['De Bruyne', 'Lukaku', 'Trossard', 'Doku', 'Onana', 'Mangala', 'Vertonghen', 'Faes'] },
  ITA: { name: 'Italy',         code: 'ITA', flag: '🇮🇹', iso: 'it', players: ['Pellegrini', 'Barella', 'Tonali', 'Chiesa', 'Retegui', 'Bastoni', 'Di Lorenzo', 'Donnarumma'] },
  CRO: { name: 'Croatia',       code: 'CRO', flag: '🇭🇷', iso: 'hr', players: ['Modrić', 'Kovačić', 'Gvardiol', 'Kramarić', 'Perisić', 'Sosa', 'Pašalić', 'Šutalo'] },
  MAR: { name: 'Morocco',       code: 'MAR', flag: '🇲🇦', iso: 'ma', players: ['En-Nesyri', 'Hakimi', 'Ziyech', 'Ounahi', 'Amrabat', 'Boufal', 'Saiss', 'Bounou'] },
  URU: { name: 'Uruguay',       code: 'URU', flag: '🇺🇾', iso: 'uy', players: ['Núñez', 'Valverde', 'Bentancur', 'Araújo', 'Pellistri', 'Ugarte', 'De Arrascaeta', 'Olivera'] },
  COL: { name: 'Colombia',      code: 'COL', flag: '🇨🇴', iso: 'co', players: ['L. Díaz', 'J. Díaz', 'Cuadrado', 'Borré', 'Arias', 'Cuesta', 'Ospina', 'Quintero'] },
  SEN: { name: 'Senegal',       code: 'SEN', flag: '🇸🇳', iso: 'sn', players: ['Mané', 'Dia', 'Sarr', 'Gueye', 'Koulibaly', 'Sabaly', 'Diatta', 'Mendy'] },
  JPN: { name: 'Japan',         code: 'JPN', flag: '🇯🇵', iso: 'jp', players: ['Kubo', 'Mitoma', 'Doan', 'Endo', 'Kamada', 'Tomiyasu', 'Taniguchi', 'Maeda'] },
  MEX: { name: 'Mexico',        code: 'MEX', flag: '🇲🇽', iso: 'mx', players: ['Jiménez', 'Lozano', 'Antuna', 'Álvarez', 'Herrera', 'Sánchez', 'Moreno', 'Ochoa'] },
  USA: { name: 'United States', code: 'USA', flag: '🇺🇸', iso: 'us', players: ['Pulisic', 'Reyna', 'McKennie', 'Musah', 'Aaronson', 'Turner', 'Dest', 'Richards'] },
  CAN: { name: 'Canada',        code: 'CAN', flag: '🇨🇦', iso: 'ca', players: ['Davies', 'David', 'Buchanan', 'Larin', 'Johnston', 'Eustáquio', 'Henry', 'Adekugbe'] },
  TUR: { name: 'Turkey',        code: 'TUR', flag: '🇹🇷', iso: 'tr', players: ['Çalhanoğlu', 'Karaman', 'Yildiz', 'Yazici', 'Kahveci', 'Söyüncü', 'Çelik', 'Günok'] },
  DEN: { name: 'Denmark',       code: 'DEN', flag: '🇩🇰', iso: 'dk', players: ['Eriksen', 'Højlund', 'Damsgaard', 'Delaney', 'Maehle', 'Christiansen', 'Andersen', 'Schmeichel'] },
  SRB: { name: 'Serbia',        code: 'SRB', flag: '🇷🇸', iso: 'rs', players: ['Tadic', 'Mitrovic', 'Milinkovic-Savic', 'Vlahovic', 'Ilic', 'Pavlovic', 'Grujic', 'Rajkovic'] },
  SUI: { name: 'Switzerland',   code: 'SUI', flag: '🇨🇭', iso: 'ch', players: ['Xhaka', 'Shaqiri', 'Embolo', 'Vargas', 'Freuler', 'Akanji', 'Elvedi', 'Sommer'] },
  CMR: { name: 'Cameroon',      code: 'CMR', flag: '🇨🇲', iso: 'cm', players: ['Choupo-Moting', 'Aboubakar', 'Toko Ekambi', 'Kunde', 'Bassogog', 'Castelletto', 'Fai', 'Epassy'] },
  AUS: { name: 'Australia',     code: 'AUS', flag: '🇦🇺', iso: 'au', players: ['Leckie', 'Mabil', 'Irvine', 'Mooy', 'McGree', 'Ryan', 'Souttar', 'Rowles'] },
  EGY: { name: 'Egypt',         code: 'EGY', flag: '🇪🇬', iso: 'eg', players: ['Salah', 'Trezeguet', 'El-Shenawy', 'Elneny', 'Mostafa Mohamed', 'Hamdy', 'Galal', 'El-Solia'] },
  KOR: { name: 'South Korea',   code: 'KOR', flag: '🇰🇷', iso: 'kr', players: ['Son Heung-min', 'Lee Jae-sung', 'Hwang Hee-chan', 'Kim Min-jae', 'Jung Woo-young', 'Na Sang-ho', 'Hwang In-beom', 'Jo Hyeon-woo'] },
  NGA: { name: 'Nigeria',       code: 'NGA', flag: '🇳🇬', iso: 'ng', players: ['Osimhen', 'Lookman', 'Iheanacho', 'Ndidi', 'Iwobi', 'Troost-Ekong', 'Collins', 'Uzoho'] },
  CIV: { name: 'Ivory Coast',   code: 'CIV', flag: '🇨🇮', iso: 'ci', players: ['Haller', 'Zaha', 'Kessié', 'Sangaré', 'Konaté', 'Gradel', 'Bailly', 'Fofana'] },
  ECU: { name: 'Ecuador',       code: 'ECU', flag: '🇪🇨', iso: 'ec', players: ['Valencia', 'Caicedo', 'Plata', 'Preciado', 'Estupiñán', 'Pacho', 'Cifuentes', 'Domínguez'] },
  ALG: { name: 'Algeria',       code: 'ALG', flag: '🇩🇿', iso: 'dz', players: ['Mahrez', 'Bennacer', 'Bensebaini', 'Atal', 'Slimani', 'Feghouli', 'Boudaoui', 'Zerrouki'] },
  KSA: { name: 'Saudi Arabia',  code: 'KSA', flag: '🇸🇦', iso: 'sa', players: ['Al-Dawsari', 'Al-Shahrani', 'Al-Malki', 'Al-Faraj', 'Al-Buraikan', 'Al-Hamdan', 'Al-Owais', 'Al-Ghannam'] },
};

// ── Fixtures ──────────────────────────────────────────────────────────────────

export const FIXTURES: Fixture[] = [
  // ── Round of 32 ──────────────────────────────────────────────────────────
  { id:'r32-1',  matchday:1, group:'R32', round:'R32', mode:'simulated', home:T.BRA, away:T.ECU, kickoff:'2026-06-22T18:00:00Z', venue:'MetLife Stadium · East Rutherford', stadium:S.METLIFE,   status:'open', baseOdds:{ home:65, draw:22, away:13 } },
  { id:'r32-2',  matchday:2, group:'R32', round:'R32', mode:'simulated', home:T.FRA, away:T.TUR, kickoff:'2026-06-22T21:00:00Z', venue:'Rose Bowl Stadium · Pasadena',      stadium:S.ROSE_BOWL, status:'open', baseOdds:{ home:56, draw:25, away:19 } },
  { id:'r32-3',  matchday:3, group:'R32', round:'R32', mode:'simulated', home:T.ARG, away:T.KOR, kickoff:'2026-06-23T00:00:00Z', venue:'AT&T Stadium · Arlington',          stadium:S.ATANDT,    status:'open', baseOdds:{ home:62, draw:22, away:16 } },
  { id:'r32-4',  matchday:4, group:'R32', round:'R32', mode:'simulated', home:T.ENG, away:T.NGA, kickoff:'2026-06-23T18:00:00Z', venue:'SoFi Stadium · Inglewood',          stadium:S.SOFI,      status:'open', baseOdds:{ home:58, draw:24, away:18 } },
  { id:'r32-5',  matchday:5, group:'R32', round:'R32', mode:'simulated', home:T.ESP, away:T.DEN, kickoff:'2026-06-23T21:00:00Z', venue:"Levi's Stadium · Santa Clara",      stadium:S.LEVIS,     status:'open', baseOdds:{ home:54, draw:26, away:20 } },
  { id:'r32-6',  matchday:6, group:'R32', round:'R32', mode:'simulated', home:T.POR, away:T.CMR, kickoff:'2026-06-24T00:00:00Z', venue:'Arrowhead Stadium · Kansas City',   stadium:S.ARROWHEAD, status:'open', baseOdds:{ home:60, draw:23, away:17 } },
  { id:'r32-7',  matchday:7, group:'R32', round:'R32', mode:'simulated', home:T.GER, away:T.MEX, kickoff:'2026-06-24T18:00:00Z', venue:'NRG Stadium · Houston',             stadium:S.NRG,       status:'open', baseOdds:{ home:57, draw:25, away:18 } },
  { id:'r32-8',  matchday:8, group:'R32', round:'R32', mode:'simulated', home:T.NED, away:T.AUS, kickoff:'2026-06-24T21:00:00Z', venue:'Mercedes-Benz Stadium · Atlanta',   stadium:S.MB_ATL,    status:'open', baseOdds:{ home:58, draw:24, away:18 } },
  { id:'r32-9',  matchday:9, group:'R32', round:'R32', mode:'simulated', home:T.BEL, away:T.JPN, kickoff:'2026-06-25T00:00:00Z', venue:'Gillette Stadium · Foxborough',     stadium:S.GILLETTE,  status:'open', baseOdds:{ home:55, draw:25, away:20 } },
  { id:'r32-10', matchday:10, group:'R32', round:'R32', mode:'simulated', home:T.ITA, away:T.COL, kickoff:'2026-06-25T18:00:00Z', venue:'Lincoln Financial Field · Philadelphia', stadium:S.LINCOLN, status:'open', baseOdds:{ home:48, draw:27, away:25 } },
  { id:'r32-11', matchday:11, group:'R32', round:'R32', mode:'simulated', home:T.CRO, away:T.CAN, kickoff:'2026-06-25T21:00:00Z', venue:'BC Place · Vancouver',              stadium:S.BC_PLACE,  status:'open', baseOdds:{ home:51, draw:27, away:22 } },
  { id:'r32-12', matchday:12, group:'R32', round:'R32', mode:'simulated', home:T.MAR, away:T.USA, kickoff:'2026-06-26T00:00:00Z', venue:'Lumen Field · Seattle',             stadium:S.LUMEN,     status:'open', baseOdds:{ home:44, draw:28, away:28 } },
  { id:'r32-13', matchday:13, group:'R32', round:'R32', mode:'simulated', home:T.URU, away:T.EGY, kickoff:'2026-06-26T18:00:00Z', venue:'BMO Field · Toronto',               stadium:S.BMO_FIELD, status:'open', baseOdds:{ home:55, draw:25, away:20 } },
  { id:'r32-14', matchday:14, group:'R32', round:'R32', mode:'simulated', home:T.SRB, away:T.SUI, kickoff:'2026-06-26T21:00:00Z', venue:'Estadio Azteca · Mexico City',      stadium:S.AZTECA,    status:'open', baseOdds:{ home:46, draw:28, away:26 } },
  { id:'r32-15', matchday:15, group:'R32', round:'R32', mode:'simulated', home:T.ALG, away:T.KSA, kickoff:'2026-06-27T00:00:00Z', venue:'Estadio BBVA · Monterrey',          stadium:S.BBVA,      status:'open', baseOdds:{ home:44, draw:28, away:28 } },
  { id:'r32-16', matchday:16, group:'R32', round:'R32', mode:'simulated', home:T.CIV, away:T.SEN, kickoff:'2026-06-27T03:00:00Z', venue:'Estadio Akron · Guadalajara',       stadium:S.AKRON,     status:'open', baseOdds:{ home:40, draw:28, away:32 } },

  // ── Round of 16 ──────────────────────────────────────────────────────────
  { id:'r16-1', matchday:1, group:'R16', round:'R16', mode:'simulated', home:T.BRA, away:T.FRA, kickoff:'2026-06-29T20:00:00Z', venue:'Rose Bowl Stadium · Pasadena',    stadium:S.ROSE_BOWL, status:'open', baseOdds:{ home:44, draw:26, away:30 } },
  { id:'r16-2', matchday:2, group:'R16', round:'R16', mode:'simulated', home:T.ARG, away:T.ENG, kickoff:'2026-06-30T00:00:00Z', venue:'AT&T Stadium · Arlington',        stadium:S.ATANDT,    status:'open', baseOdds:{ home:44, draw:26, away:30 } },
  { id:'r16-3', matchday:3, group:'R16', round:'R16', mode:'simulated', home:T.ESP, away:T.POR, kickoff:'2026-06-30T20:00:00Z', venue:'MetLife Stadium · East Rutherford', stadium:S.METLIFE,   status:'open', baseOdds:{ home:46, draw:27, away:27 } },
  { id:'r16-4', matchday:4, group:'R16', round:'R16', mode:'simulated', home:T.GER, away:T.NED, kickoff:'2026-07-01T00:00:00Z', venue:'SoFi Stadium · Inglewood',        stadium:S.SOFI,      status:'open', baseOdds:{ home:46, draw:27, away:27 } },
  { id:'r16-5', matchday:5, group:'R16', round:'R16', mode:'simulated', home:T.BEL, away:T.ITA, kickoff:'2026-07-01T20:00:00Z', venue:'NRG Stadium · Houston',           stadium:S.NRG,       status:'open', baseOdds:{ home:47, draw:26, away:27 } },
  { id:'r16-6', matchday:6, group:'R16', round:'R16', mode:'simulated', home:T.CRO, away:T.MAR, kickoff:'2026-07-02T00:00:00Z', venue:'Arrowhead Stadium · Kansas City', stadium:S.ARROWHEAD, status:'open', baseOdds:{ home:46, draw:27, away:27 } },
  { id:'r16-7', matchday:7, group:'R16', round:'R16', mode:'simulated', home:T.URU, away:T.SRB, kickoff:'2026-07-02T20:00:00Z', venue:'Gillette Stadium · Foxborough',   stadium:S.GILLETTE,  status:'open', baseOdds:{ home:48, draw:26, away:26 } },
  { id:'r16-8', matchday:8, group:'R16', round:'R16', mode:'simulated', home:T.CIV, away:T.MEX, kickoff:'2026-07-03T00:00:00Z', venue:'Allegiant Stadium · Las Vegas',   stadium:S.ALLEGIANT, status:'open', baseOdds:{ home:41, draw:28, away:31 } },

  // ── Quarter-Finals ───────────────────────────────────────────────────────
  { id:'qf-1', matchday:1, group:'QF', round:'QF', mode:'simulated', home:T.BRA, away:T.ARG, kickoff:'2026-07-04T20:00:00Z', venue:'SoFi Stadium · Inglewood',       stadium:S.SOFI,      status:'open', baseOdds:{ home:47, draw:24, away:29 } },
  { id:'qf-2', matchday:2, group:'QF', round:'QF', mode:'simulated', home:T.ESP, away:T.GER, kickoff:'2026-07-05T00:00:00Z', venue:'Rose Bowl Stadium · Pasadena',   stadium:S.ROSE_BOWL, status:'open', baseOdds:{ home:47, draw:25, away:28 } },
  { id:'qf-3', matchday:3, group:'QF', round:'QF', mode:'simulated', home:T.BEL, away:T.ENG, kickoff:'2026-07-05T20:00:00Z', venue:'MetLife Stadium · East Rutherford', stadium:S.METLIFE, status:'open', baseOdds:{ home:46, draw:26, away:28 } },
  { id:'qf-4', matchday:4, group:'QF', round:'QF', mode:'simulated', home:T.CRO, away:T.URU, kickoff:'2026-07-06T00:00:00Z', venue:'AT&T Stadium · Arlington',       stadium:S.ATANDT,    status:'open', baseOdds:{ home:50, draw:26, away:24 } },

  // ── Semi-Finals ──────────────────────────────────────────────────────────
  { id:'sf-1', matchday:1, group:'SF', round:'SF', mode:'simulated', home:T.BRA, away:T.ESP, kickoff:'2026-07-08T20:00:00Z', venue:'Rose Bowl Stadium · Pasadena',      stadium:S.ROSE_BOWL, status:'open', baseOdds:{ home:49, draw:25, away:26 } },
  { id:'sf-2', matchday:2, group:'SF', round:'SF', mode:'simulated', home:T.ARG, away:T.BEL, kickoff:'2026-07-09T20:00:00Z', venue:'MetLife Stadium · East Rutherford', stadium:S.METLIFE,   status:'open', baseOdds:{ home:50, draw:25, away:25 } },

  // ── Third Place ──────────────────────────────────────────────────────────
  { id:'3pl-1', matchday:1, group:'3PL', round:'3PL', mode:'simulated', home:T.ESP, away:T.ARG, kickoff:'2026-07-12T20:00:00Z', venue:'AT&T Stadium · Arlington', stadium:S.ATANDT, status:'open', baseOdds:{ home:47, draw:26, away:27 } },

  // ── Final ────────────────────────────────────────────────────────────────
  { id:'f-1', matchday:1, group:'F', round:'F', mode:'simulated', home:T.BRA, away:T.BEL, kickoff:'2026-07-15T20:00:00Z', venue:'MetLife Stadium · East Rutherford', stadium:S.METLIFE, status:'open', baseOdds:{ home:52, draw:24, away:24 } },
];
