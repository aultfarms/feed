import debug from 'debug';
import type { TrelloCard, TrelloList } from '@aultfarms/trello';
import { client } from '@aultfarms/trello';
import type { GrainBoard, GrainRecord, ErrorRecord, GrainSellerList } from './types.js';
import { grainTrelloConfig } from './types.js';
import numeral from 'numeral';

const warn = debug('af/trucking#grain:warn');

let _grainBoard: GrainBoard | null = null;
let grainBoardName = grainTrelloConfig.board;
export async function grainBoard({ client, name, force }: { client: client.Client, name?: string, force?: true }): Promise<GrainBoard> {
  if (!_grainBoard || force) {
    grainBoardName = name || grainBoardName;
    const boardid = await client.findBoardidByName(grainBoardName);
    if (!boardid) throw new Error('ERROR: could not find "'+name+'" board in Trello for grain');
    const lists = await client.findListsAndCardsOnBoard({ boardid });
    const ret: GrainBoard = {
      sellerLists: [],
      webControls: { idList: '', settings: { drivers: [], destinations: [], crops: [] } },
      errors: [],
    };

    // sellLists
    const allLists = lists.filter(l => l.name !== grainTrelloConfig.webControlsList);
    if (!allLists || allLists.length < 1) throw new Error('ERROR: did not find any seller lists in board for grain');
    for (const l of allLists) {
      const sl: GrainSellerList = {
        idList: l.id,
        name: l.name,
        records: [],
      };
      if (l.cards) {
        for (const c of l.cards) {
          const r = grainCardToRecord(c, l);
          if ('error' in r && r.error) {
            ret.errors.push(r.error);
          } else {
            sl.records.push(r as GrainRecord);
          }
        }
      }
      ret.sellerLists.push(sl);
    }

    // WebControls:
    const webControlsList = lists.find(l => l.name === grainTrelloConfig.webControlsList);
    if (!webControlsList || !webControlsList.cards) throw new Error('ERROR: could not find "'+grainTrelloConfig.webControlsList+'" list in board for grain');
    ret.webControls.idList = webControlsList.id;
    for (const c of webControlsList.cards) {
      switch(c.name.trim()) {
        case 'Drivers':
          ret.webControls.settings.drivers = c.desc.split(';').map(d => d.trim()).filter(d => !!d);
        break;
        case 'Destinations':
          ret.webControls.settings.destinations = c.desc.split(';').map(d => d.trim()).filter(d => !!d);
        break;
        case 'Crops':
          ret.webControls.settings.crops = c.desc.split(';').map(d => d.trim()).filter(d => !!d);
        break;
      }
    }

    _grainBoard = ret;
  }
  return _grainBoard;
}

export function grainCardToRecord(c: TrelloCard, l: TrelloList): GrainRecord | ErrorRecord {
  try {
    const sellerList = { name: l.name, idList: l.id };
    let rest = c.name.trim();
    let matches = rest.match(/^([0-9]{4}-[0-9]{1,2}-[0-9]{1,2}): *(.*)$/);
    if (!matches) return {
      error: 'Tried to read grain hauling card "'+c.name+'" from list "'+sellerList.name+'", but main pattern failed to match',
    };
    const date = matches?.[1] || '';
    rest = matches[2] || '';
    matches = rest.match(/^([0-9,]+(\.[0-9]+)?) +bu +(.*)$/);
    const bushels = +(matches?.[1]?.replace(',','') || '0');
    rest = matches?.[3] || '';
    matches = rest.match(/^(CORN|BEANS|WHEAT)\. +(.*)$/);
    const crop = matches?.[1] || '';
    rest = matches?.[2] || '';
    matches = rest.match(/^([^-]+) *- *(.*)$/);
    const dest = matches?.[1]?.trim() || '';
    rest = matches?.[2] || '';
    matches = rest.match(/^Tkt #([^- ]+) *- *(.*)$/);
    const ticket = matches?.[1]?.trim() || '';
    rest = matches?.[2] || '';
    matches = rest.match(/^(.+?)(?:\.\s{2,}(.*))?$/);
    const driver = matches?.[1]?.trim() || '';
    rest = matches?.[2] || '';
    const note = (rest && rest.trim()) || '';

    return {
      date,
      sellerList,
      dest,
      bushels,
      ticket,
      crop,
      driver,
      note,

      id: c.id,
      idList: c.idList,
      cardName: c.name,
      dateLastActivity: c.dateLastActivity,
    };

  } catch(e: any) {
    return {
      error: 'Unable to parse grain delivered card: "'+c.name+'"  Error was: '+e.toString(),
    }
  }
}

// Note: currently does not do the labels yet.  Look to lib/overmind/src/grain to see how that was done, or just the trello API.
export async function saveGrainDelivered({ client, record }: { client: client.Client, record: GrainRecord }) {
  const r = record;
  let name = `${r.date}: ${numeral(r.bushels).format('0,0.000')} bu ${r.crop}.  ${r.dest} - Tkt #${r.ticket} - ${r.driver}`;
  if (r.note) name += '.  '+r.note;
  await client.saveNewCardAtBottomOfList({ name, idList: record.sellerList.idList });
}