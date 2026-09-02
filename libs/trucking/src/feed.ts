import debug from 'debug';
import type { TrelloCard } from '@aultfarms/trello';
import { client } from '@aultfarms/trello';
import type { FeedBoard, FeedRecord, ErrorRecord } from './types.js';
import { feedTrelloConfig } from './types.js';
import numeral from 'numeral';

const warn = debug('af/trucking#feed:warn');

let _feedBoard: FeedBoard | null = null;
let feedBoardName = feedTrelloConfig.board;
export async function feedBoard({ client, name, force }: { client: client.Client, name?: string, force?: true }): Promise<FeedBoard> {
  if (!_feedBoard || force) {
    feedBoardName = name || feedBoardName;
    const boardid = await client.findBoardidByName(feedBoardName);
    if (!boardid) throw new Error('ERROR: could not find "'+name+'" board in Trello for feed');
    const lists = await client.findListsAndCardsOnBoard({ boardid });
    const ret: FeedBoard = {
      delivered: { idList: '', records: [] },
      available: { idList: '', records: [] },
      webControls: { idList: '', settings: { drivers: [], destinations: [], sources: [] } },
      errors: [],
    };

    // Deliveries:
    const deliveredList = lists.find(l => l.name === feedTrelloConfig.deliveredList);
    if (!deliveredList) throw new Error('ERROR: could not find "'+feedTrelloConfig.deliveredList+'" list in board for feed');
    ret.delivered.idList = deliveredList.id;
    for (const c of deliveredList.cards ?? []) {
      const r = feedDeliveredCardToRecord(c);
      if ('error' in r && r.error) {
        ret.errors.push(r.error);
      } else {
        ret.delivered.records.push(r as FeedRecord);
      }
    }

    // Available load numbers:
    const availableList = lists.find(l => l.name === feedTrelloConfig.availableList);
    if (!availableList) throw new Error('ERROR: could not find "'+feedTrelloConfig.availableList +'" list in board for feed');
    ret.available.idList = availableList.id;
    for (const c of availableList.cards ?? []) {
      ret.available.records.push({ id: c.id, name: c.name });
    }

    // WebControls:
    const webControlsList = lists.find(l => l.name === feedTrelloConfig.webControlsList);
    if (!webControlsList || !webControlsList.cards) throw new Error('ERROR: could not find "'+feedTrelloConfig.webControlsList+'" list in board for feed');
    ret.webControls.idList = webControlsList.id;
    for (const c of webControlsList.cards) {
      switch(c.name.trim()) {
        case 'Drivers':
          ret.webControls.settings.drivers = c.desc.split(';').map(d => d.trim()).filter(d => !!d);
        break;
        case 'Destinations':
          ret.webControls.settings.destinations = c.desc.split(';').map(d => d.trim()).filter(d => !!d);
        break;
        case 'Sources':
          ret.webControls.settings.sources = c.desc.split(';').map(d => d.trim()).filter(d => !!d);
        break;
      }
    }

    _feedBoard = ret;
  }
  return _feedBoard;
}

export function feedDeliveredCardToRecord(c: TrelloCard): FeedRecord | ErrorRecord {
  try {
    if (!c.name) throw 'Card.name does not exist'
    // Date on front:
    let matches = c.name.match(/([0-9]{4}-[0-9]{2}-[0-9]{2}): *(.*)$/);
    if (!matches || !matches[1]) throw 'Could not match date';
    const date = matches[1].trim();

    let rest = matches[2];
    if (!rest) throw 'No string after date';
    // Next is source+number (up to a period)
    matches = rest.match(/^([^.]*). *(.*)$/);
    rest = matches?.[2];
    if (!rest) throw 'No string after source+number';
    if (!matches || !matches[1]) throw 'Could not match source+number';
    const sourceAndNumber = matches[1].trim().replace('/ *pellets */g','');

    matches = sourceAndNumber.match(/^([^0-9]+)?(.*)$/);
    if (!matches) throw 'Could not match source name+number';
    const source = (matches[1] ? matches[1].trim() : 'NONE').toUpperCase();
    const loadNumber = matches[2] ? matches[2].trim() : '';

    // Then comes pounds w/ period instead of comma sometimes
    matches = rest.match(/(([0-9]+[,.])?[0-9]*) +lbs +- +(.*)$/);
    if (!matches || !matches[1]) throw 'Could not match weight';
    const weight = +(matches[1].replace(/[,.]/g,'').trim()); // convert to number
    rest = matches[3];
    if (!rest) throw 'No string after weight';

    // Then comes destination
    matches = rest.match(/([^-]+) *- *(.*)$/);
    if (!matches || !matches[1]) throw 'Could not match destination';
    const dest = matches[1].toUpperCase().trim();
    rest = matches[2];
    if (!rest) throw 'No string after dest';
    // Now driver
    matches = rest.match(/([^.]*)(. *(.*))?$/);
    if (!matches || !matches[1]) throw 'Could not match driver';
    const driver = matches[1].trim();
    rest = matches[3] || '';
    if (typeof rest !== 'string') throw 'No string after driver';

    // Optional note
    const note = (rest && rest.trim()) || '';

    // Set true/false properties based on labels:
    const     invoiced = !!c.labels.find(l => l === 'orange');
    const      paidFor = !!c.labels.find(l => l === 'green');
    const truckingPaid = !!c.labels.find(l => l === 'blue');

    return {
      date,
      source,
      loadNumber,
      weight,
      dest,
      driver,
      note,
      invoiced,
      paidFor,
      truckingPaid,
      cardName: c.name,
      id: c.id,
      idList: c.idList,
      dateLastActivity: c.dateLastActivity,
    };
  } catch(e: any) {
    return {
      error: 'Unable to parse feed delivered card: "'+c.name+'"  Error was: '+e.toString(),
    }
  }
}

// Note: currently does not do the labels yet.  Look to lib/overmind/src/feed to see how that was done, or just the trello API.
export async function saveFeedDelivered({ client, record }: { client: client.Client, record: FeedRecord }) {
  const r = record;
  const fb = await feedBoard({ client });
  let name = `${r.date}: ${r.source} ${r.loadNumber}.  ${numeral(r.weight).format('0,0')} lbs - ${r.dest} - ${r.driver}`;
  if (r.note) name += '.  '+r.note;
  const idList = fb.delivered.idList;
  if (r.id) { // This is an existing card
    await client.updateExistingCardNameAndMoveToBottomOfList({name, idList, cardid: r.id });
  } else { // New card (i.e. a new load number)
    await client.saveNewCardAtBottomOfList({ name, idList: fb.delivered.idList });
  }
}

export async function saveAvailableLoadNumber({ client, loadnumstr }: { client: client.Client, loadnumstr: string }) {
  const fb = await feedBoard({ client });
  await client.saveNewCardAtBottomOfList({ name: loadnumstr, idList: fb.available.idList });
}