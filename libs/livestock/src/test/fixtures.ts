import type { TrelloCard } from '@aultfarms/trello';

export function fixtureCard(
  id: string,
  idList: string,
  name: string,
  desc = '',
): TrelloCard {
  return {
    id,
    idList,
    name,
    desc,
    idBoard: 'board-livestock',
    closed: false,
    dateLastActivity: '2025-01-15T12:00:00.000Z',
    labels: [],
    pos: 1,
  };
}

export const tagColors = {
  RED: '#FF0000',
  YELLOW: '#FFFF00',
  BLACK: '#000000',
};

export const treatmentTypes = [
  { code: 'Z', name: 'Z medicine' },
  { code: 'Za', name: 'Za medicine' },
  { code: 'N', name: 'N medicine' },
  { code: 'No', name: 'No medicine' },
  { code: 'E', name: 'E support' },
  { code: 'Ex', name: 'Ex support' },
  { code: 'Dr', name: 'Dr medicine' },
  { code: 'Ht', name: 'High temperature' },
];

export const configCards = {
  tagColors: fixtureCard(
    'config-colors',
    'list-config',
    'Tag Colors',
    JSON.stringify(tagColors),
  ),
  treatmentTypes: fixtureCard(
    'config-treatments',
    'list-config',
    'Treatment Types',
    JSON.stringify(treatmentTypes),
  ),
};

export const validCards = {
  incoming: fixtureCard(
    'incoming-2024',
    'list-incoming',
    '2024-01-15: TEST:JAN24-1; Into: North; Weight: 612.5; Head: 40; Tags: RED1-RED20,YELLOW1-YELLOW20;',
  ),
  treatment: fixtureCard(
    'treatment-2024',
    'list-treatments',
    '2024-02-01: ZaNoEx: RED1 YELLOW2',
  ),
  dead: fixtureCard(
    'dead-2024',
    'list-dead',
    '2024-2-4: RED1 N1 (historical pen note) NOTAG Note: sanitized example',
  ),
};

export const historicalGroupCards = [
  fixtureCard(
    'incoming-old',
    'list-incoming',
    '2023-01-01: TEST:JAN23-1; Head: 10; Tags: RED1-RED3;',
  ),
  fixtureCard(
    'incoming-new',
    'list-incoming',
    '2024-01-01: TEST:JAN24-1; Tags: RED1-RED3;',
  ),
  fixtureCard(
    'incoming-yellow',
    'list-incoming',
    '2024-01-01: TEST:JAN24-2; Head: 20; Tags: YELLOW1-YELLOW20;',
  ),
  fixtureCard(
    'incoming-zero',
    'list-incoming',
    '2024-01-01: TEST:JAN24-3; Head: 5; Tags: BLACK1-BLACK5;',
  ),
];

export const invalidCards = {
  incomingFormat: fixtureCard('bad-incoming-format', 'list-incoming', 'not an incoming card'),
  incomingDate: fixtureCard(
    'bad-incoming-date',
    'list-incoming',
    '2024-02-31: TEST:FEB24-1; Head: 10;',
  ),
  incomingHead: fixtureCard(
    'bad-incoming-head',
    'list-incoming',
    '2024-02-01: TEST:FEB24-1; Head: 1.5;',
  ),
  incomingRange: fixtureCard(
    'bad-incoming-range',
    'list-incoming',
    '2024-02-01: TEST:FEB24-1; Tags: RED20-RED1;',
  ),
  incomingColor: fixtureCard(
    'bad-incoming-color',
    'list-incoming',
    '2024-02-01: TEST:FEB24-1; Tags: PURPLE1-PURPLE2;',
  ),
  treatmentDate: fixtureCard(
    'bad-treatment-date',
    'list-treatments',
    '2023-13-01: Za: RED1',
  ),
  treatmentProtocol: fixtureCard(
    'bad-treatment-protocol',
    'list-treatments',
    '2024-02-01: ZaQ: RED1',
  ),
  treatmentTag: fixtureCard(
    'bad-treatment-tag',
    'list-treatments',
    '2024-02-01: Za: RED',
  ),
  deadDate: fixtureCard('bad-dead-date', 'list-dead', '2024-02-31: RED1'),
  deadTags: fixtureCard('bad-dead-tags', 'list-dead', '2024-02-01: North pen'),
  deadColor: fixtureCard('bad-dead-color', 'list-dead', '2024-02-01: PURPLE1'),
  configJson: fixtureCard('bad-config-json', 'list-config', 'Tag Colors', '{oops'),
  configValue: fixtureCard(
    'bad-config-value',
    'list-config',
    'Treatment Types',
    JSON.stringify([{ code: 'Bad Code', name: '' }]),
  ),
};
