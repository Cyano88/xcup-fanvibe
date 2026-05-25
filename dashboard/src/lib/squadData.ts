import type { Team } from '../types';

export interface SquadPlayer {
  no: number;
  name: string;
  pos: 'GK' | 'DF' | 'MF' | 'FW';
}

export interface TeamSquad {
  coach: string;
  starters: SquadPlayer[];
  substitutes: SquadPlayer[];
  officialPending?: boolean;
}

const P = (no: number, name: string, pos: SquadPlayer['pos']): SquadPlayer => ({ no, name, pos });

export const SQUADS: Record<string, TeamSquad> = {
  KOR: {
    coach: 'Hong Myung-bo',
    starters: [
      P(1, 'Jo Hyeon-woo', 'GK'), P(2, 'Seol Young-woo', 'DF'), P(4, 'Kim Min-jae', 'DF'), P(19, 'Kim Young-gwon', 'DF'),
      P(3, 'Lee Myung-jae', 'DF'), P(5, 'Park Yong-woo', 'MF'), P(6, 'Hwang In-beom', 'MF'), P(18, 'Lee Kang-in', 'MF'),
      P(7, 'Son Heung-min', 'FW'), P(11, 'Hwang Hee-chan', 'FW'), P(10, 'Lee Jae-sung', 'MF'),
    ],
    substitutes: [
      P(12, 'Song Bum-keun', 'GK'), P(21, 'Kim Seung-gyu', 'GK'), P(15, 'Jung Seung-hyun', 'DF'), P(20, 'Kwon Kyung-won', 'DF'),
      P(22, 'Cho Yu-min', 'DF'), P(8, 'Paik Seung-ho', 'MF'), P(13, 'Hong Hyun-seok', 'MF'), P(14, 'Jeong Woo-yeong', 'MF'),
      P(16, 'Hwang Ui-jo', 'FW'), P(17, 'Na Sang-ho', 'FW'), P(9, 'Cho Gue-sung', 'FW'), P(23, 'Oh Hyeon-gyu', 'FW'),
    ],
  },
  CZE: {
    coach: 'Ivan Hasek',
    starters: [
      P(1, 'Jindrich Stanek', 'GK'), P(5, 'Vladimir Coufal', 'DF'), P(3, 'Tomas Holes', 'DF'), P(4, 'David Zima', 'DF'),
      P(18, 'Ladislav Krejci', 'DF'), P(22, 'Tomas Soucek', 'MF'), P(7, 'Antonin Barak', 'MF'), P(14, 'Lukas Provod', 'MF'),
      P(17, 'Vaclav Cerny', 'FW'), P(10, 'Patrik Schick', 'FW'), P(9, 'Adam Hlozek', 'FW'),
    ],
    substitutes: [
      P(16, 'Matej Kovar', 'GK'), P(23, 'Tomas Vaclik', 'GK'), P(2, 'David Doudera', 'DF'), P(6, 'Martin Vitik', 'DF'),
      P(12, 'David Jurasek', 'DF'), P(8, 'Michal Sadilek', 'MF'), P(11, 'Jan Kuchta', 'FW'), P(13, 'Mojmir Chytil', 'FW'),
      P(15, 'Pavel Sulc', 'MF'), P(19, 'Ondrej Lingr', 'MF'), P(20, 'Vaclav Jurecka', 'FW'), P(21, 'Alex Kral', 'MF'),
    ],
  },
  BRA: {
    coach: 'Carlo Ancelotti',
    starters: [
      P(1, 'Alisson', 'GK'), P(2, 'Danilo', 'DF'), P(3, 'Marquinhos', 'DF'), P(4, 'Gabriel Magalhaes', 'DF'),
      P(6, 'Guilherme Arana', 'DF'), P(5, 'Bruno Guimaraes', 'MF'), P(8, 'Lucas Paqueta', 'MF'), P(11, 'Raphinha', 'FW'),
      P(10, 'Neymar', 'FW'), P(7, 'Vinicius Jr', 'FW'), P(9, 'Rodrygo', 'FW'),
    ],
    substitutes: [
      P(12, 'Ederson', 'GK'), P(23, 'Bento', 'GK'), P(13, 'Eder Militao', 'DF'), P(14, 'Bremer', 'DF'),
      P(15, 'Wendell', 'DF'), P(16, 'Douglas Luiz', 'MF'), P(17, 'Joao Gomes', 'MF'), P(18, 'Andreas Pereira', 'MF'),
      P(19, 'Endrick', 'FW'), P(20, 'Savinho', 'FW'), P(21, 'Gabriel Martinelli', 'FW'), P(22, 'Richarlison', 'FW'),
    ],
  },
  FRA: {
    coach: 'Didier Deschamps',
    starters: [
      P(1, 'Mike Maignan', 'GK'), P(5, 'Jules Kounde', 'DF'), P(4, 'William Saliba', 'DF'), P(17, 'Ibrahima Konate', 'DF'),
      P(22, 'Theo Hernandez', 'DF'), P(8, 'Aurelien Tchouameni', 'MF'), P(14, 'Adrien Rabiot', 'MF'), P(7, 'Antoine Griezmann', 'MF'),
      P(11, 'Ousmane Dembele', 'FW'), P(10, 'Kylian Mbappe', 'FW'), P(15, 'Marcus Thuram', 'FW'),
    ],
    substitutes: [
      P(16, 'Brice Samba', 'GK'), P(23, 'Alphonse Areola', 'GK'), P(2, 'Benjamin Pavard', 'DF'), P(3, 'Dayot Upamecano', 'DF'),
      P(6, 'Eduardo Camavinga', 'MF'), P(9, 'Olivier Giroud', 'FW'), P(12, 'Randal Kolo Muani', 'FW'), P(13, 'Kingsley Coman', 'FW'),
      P(18, 'Warren Zaire-Emery', 'MF'), P(19, 'Youssouf Fofana', 'MF'), P(20, 'Bradley Barcola', 'FW'), P(21, 'Lucas Hernandez', 'DF'),
    ],
  },
  ENG: {
    coach: 'Thomas Tuchel',
    starters: [
      P(1, 'Jordan Pickford', 'GK'), P(2, 'Kyle Walker', 'DF'), P(5, 'John Stones', 'DF'), P(6, 'Marc Guehi', 'DF'),
      P(3, 'Luke Shaw', 'DF'), P(4, 'Declan Rice', 'MF'), P(8, 'Jude Bellingham', 'MF'), P(10, 'Phil Foden', 'MF'),
      P(7, 'Bukayo Saka', 'FW'), P(9, 'Harry Kane', 'FW'), P(11, 'Anthony Gordon', 'FW'),
    ],
    substitutes: [
      P(13, 'Aaron Ramsdale', 'GK'), P(23, 'Dean Henderson', 'GK'), P(12, 'Trent Alexander-Arnold', 'DF'), P(14, 'Ezri Konsa', 'DF'),
      P(15, 'Kobbie Mainoo', 'MF'), P(16, 'Conor Gallagher', 'MF'), P(17, 'Ivan Toney', 'FW'), P(18, 'Ollie Watkins', 'FW'),
      P(19, 'Cole Palmer', 'MF'), P(20, 'Eberechi Eze', 'MF'), P(21, 'Jarrod Bowen', 'FW'), P(22, 'Joe Gomez', 'DF'),
    ],
  },
  GER: { coach: 'Julian Nagelsmann', starters: [], substitutes: [] },
  ESP: { coach: 'Luis de la Fuente', starters: [], substitutes: [] },
  ARG: { coach: 'Lionel Scaloni', starters: [], substitutes: [] },
  POR: { coach: 'Roberto Martinez', starters: [], substitutes: [] },
  NED: { coach: 'Ronald Koeman', starters: [], substitutes: [] },
  MEX: { coach: 'Javier Aguirre', starters: [], substitutes: [] },
  USA: { coach: 'Mauricio Pochettino', starters: [], substitutes: [] },
  CAN: { coach: 'Jesse Marsch', starters: [], substitutes: [] },
};

function fallbackSquad(team: Team): TeamSquad {
  return {
    coach: `${team.name} coach`,
    starters: [],
    substitutes: [],
    officialPending: true,
  };
}

export function getSquad(team: Team): TeamSquad {
  const squad = SQUADS[team.code];
  if (!squad) return fallbackSquad(team);
  if (!squad.starters.length) return { ...fallbackSquad(team), coach: squad.coach };
  return squad;
}

export function squadPlayers(team: Team): SquadPlayer[] {
  const squad = getSquad(team);
  return [...squad.starters, ...squad.substitutes];
}
