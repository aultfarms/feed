import { makeAutoObservable } from 'mobx';
import type {
  AnalyticsFilters,
  DuplicateDeath,
  LivestockRecords,
  ParseIssue,
  Tag,
} from '@aultfarms/livestock';

export type DeadView = 'prefs' | 'date' | 'tag' | 'groups' | 'trends' | 'issues';

export type DeathDraft = {
  date: string;
  tag: Tag;
  note: string;
};

export type Activity = {
  id: number;
  type: 'success' | 'info' | 'warning' | 'error';
  text: string;
  at: Date;
};

export type RepairUndo = {
  issue: ParseIssue;
  field: 'name' | 'desc';
  oldValue: string;
  newValue: string;
};

export type PendingDuplicate = DuplicateDeath & {
  requestedDate: string;
};

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export class DeadState {
  loading = true;
  saving = false;
  repairing = false;
  trelloAuthorized = false;
  records: LivestockRecords | null = null;
  fatalError = '';
  dirty = false;
  view: DeadView = 'date';
  draft: DeathDraft = {
    date: today(),
    tag: { color: '', number: 0 },
    note: '',
  };
  filters: AnalyticsFilters = {};
  pendingDuplicate: PendingDuplicate | null = null;
  snackbar: Activity & { open: boolean } = {
    id: 0,
    type: 'info',
    text: '',
    at: new Date(0),
    open: false,
  };
  activity: Activity[] = [];
  lastRepair: RepairUndo | null = null;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

export const state = new DeadState();
