import { action, runInAction } from 'mobx';
import * as trelloLibrary from '@aultfarms/trello';
import {
  records as livestockRecords,
  repairCardName,
  repairConfigCardDescription,
  resolveTrelloCardUrl,
  upsertDeath,
  type AnalyticsFilters,
  type ConfigKind,
  type ParseIssue,
  type RecordKind,
} from '@aultfarms/livestock';
import { DeadState, type DeadView, type DeathDraft } from './state';

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function kindForIssue(issue: ParseIssue): RecordKind | null {
  if (issue.listName === 'Incoming') return 'incoming';
  if (issue.listName === 'Treatments') return 'treatment';
  if (issue.listName === 'Dead') return 'dead';
  return null;
}

function configKindForIssue(issue: ParseIssue): ConfigKind | null {
  if (issue.listName !== 'Config') return null;
  if (issue.card?.raw.name === 'Tag Colors' || issue.field === 'Tag Colors') return 'tagColors';
  if (issue.card?.raw.name === 'Treatment Types' || issue.field?.startsWith('Treatment Types')) {
    return 'treatmentTypes';
  }
  return null;
}

export class DeadActions {
  private trello: trelloLibrary.client.Client | null = null;
  private connected = false;

  constructor(private state: DeadState) {}

  private notify(type: 'success' | 'info' | 'warning' | 'error', text: string) {
    const activity = { id: Date.now(), type, text, at: new Date() };
    this.state.activity.unshift(activity);
    this.state.activity = this.state.activity.slice(0, 25);
    this.state.snackbar = { ...activity, open: true };
  }

  private async requireTrello(): Promise<trelloLibrary.client.Client> {
    if (!this.trello) this.trello = trelloLibrary.getClient();
    if (!this.connected) {
      await this.trello.connect({ org: trelloLibrary.defaultOrg });
      this.connected = true;
    }
    return this.trello;
  }

  setAuthorized(authorized: boolean) {
    this.state.trelloAuthorized = authorized;
  }

  changeDraft(change: Partial<DeathDraft>) {
    this.state.draft = { ...this.state.draft, ...change };
    this.state.pendingDuplicate = null;
    this.state.dirty = true;
  }

  appendTagDigit(digit: number) {
    const prefix = this.state.draft.tag.number || 0;
    this.changeDraft({
      tag: { ...this.state.draft.tag, number: Number(`${prefix}${digit}`) },
    });
  }

  backspaceTagNumber() {
    const value = String(this.state.draft.tag.number || '');
    this.changeDraft({
      tag: { ...this.state.draft.tag, number: Number(value.slice(0, -1)) || 0 },
    });
  }

  clearTag() {
    this.changeDraft({ tag: { color: '', number: 0 } });
  }

  setView(view: DeadView) {
    this.state.view = view;
  }

  setFilters(filters: AnalyticsFilters) {
    this.state.filters = filters;
  }

  closeSnackbar() {
    this.state.snackbar.open = false;
  }

  loadRecords = action(async () => {
    this.state.loading = true;
    this.state.fatalError = '';
    try {
      const records = await livestockRecords.fetchRecords(await this.requireTrello());
      runInAction(() => {
        this.state.records = records;
        if (!this.state.draft.tag.color) {
          this.state.draft.tag.color = Object.keys(records.tagcolors)[0] || '';
        }
      });
    } catch (error) {
      runInAction(() => {
        this.state.fatalError = message(error);
        this.notify('error', `Could not load livestock records: ${message(error)}`);
      });
    } finally {
      runInAction(() => { this.state.loading = false; });
    }
  });

  saveDeath = action(async (force = false) => {
    if (!this.state.records || this.state.saving) return;
    this.state.saving = true;
    this.state.pendingDuplicate = null;
    try {
      const result = await upsertDeath(
        await this.requireTrello(),
        this.state.records,
        {
          date: this.state.draft.date,
          tag: this.state.draft.tag,
          note: this.state.draft.note || false,
          duplicateWindowDays: force ? -1 : 14,
        },
      );
      if (result.status === 'duplicate' && result.duplicate) {
        runInAction(() => {
          this.state.pendingDuplicate = {
            ...result.duplicate!,
            requestedDate: this.state.draft.date,
          };
          this.notify(
            'warning',
            `${this.state.draft.tag.color}${this.state.draft.tag.number} was recorded dead `
              + `${result.duplicate!.daysApart} day(s) from this date. Nothing was saved.`,
          );
        });
        return;
      }
      if (result.status === 'unchanged') {
        runInAction(() => {
          this.notify('warning', 'This tag is already recorded dead on the selected date. Nothing was saved.');
        });
        return;
      }
      const nextRecords = await livestockRecords.fetchRecords(await this.requireTrello());
      runInAction(() => {
        this.state.records = nextRecords;
        this.state.draft = {
          ...this.state.draft,
          tag: { ...this.state.draft.tag, number: 0 },
          note: '',
        };
        this.state.dirty = false;
        this.state.pendingDuplicate = null;
        this.notify('success', `Death record ${result.status} in Trello.`);
      });
    } catch (error) {
      runInAction(() => {
        this.notify('error', `Could not save death record: ${message(error)}. Your entry was kept.`);
      });
    } finally {
      runInAction(() => { this.state.saving = false; });
    }
  });

  repairIssue = action(async (issue: ParseIssue, newName: string) => {
    const kind = kindForIssue(issue);
    const card = issue.card;
    if (!kind || !card || !this.state.records) return;
    this.state.repairing = true;
    try {
      await repairCardName(await this.requireTrello(), {
        kind,
        card: {
          id: card.id,
          idList: card.idList,
          name: card.raw.name,
          desc: card.raw.description,
          dateLastActivity: card.dateLastActivity,
        },
        newName,
        options: {
          tagColors: this.state.records.tagcolors,
          treatmentTypes: this.state.records.treatmentTypes,
        },
      });
      const nextRecords = await livestockRecords.fetchRecords(await this.requireTrello());
      runInAction(() => {
        this.state.records = nextRecords;
        this.state.lastRepair = {
          issue,
          field: 'name',
          oldValue: card.raw.name,
          newValue: newName,
        };
        this.notify('success', 'Card name repaired. You can undo this rename until another repair.');
      });
    } catch (error) {
      runInAction(() => this.notify('error', `Could not repair card: ${message(error)}`));
    } finally {
      runInAction(() => { this.state.repairing = false; });
    }
  });

  repairConfigIssue = action(async (issue: ParseIssue, newDescription: string) => {
    const kind = configKindForIssue(issue);
    const card = issue.card;
    if (!kind || !card || this.state.repairing) return;
    this.state.repairing = true;
    try {
      await repairConfigCardDescription(await this.requireTrello(), {
        kind,
        card: {
          id: card.id,
          idList: card.idList,
          name: card.raw.name,
          desc: card.raw.description,
          dateLastActivity: card.dateLastActivity,
        },
        newDescription,
      });
      const nextRecords = await livestockRecords.fetchRecords(await this.requireTrello());
      runInAction(() => {
        this.state.records = nextRecords;
        this.state.lastRepair = {
          issue,
          field: 'desc',
          oldValue: card.raw.description || '',
          newValue: newDescription,
        };
        this.notify('success', 'Config card repaired. You can undo this edit until another repair.');
      });
    } catch (error) {
      runInAction(() => this.notify('error', `Could not repair config card: ${message(error)}`));
    } finally {
      runInAction(() => { this.state.repairing = false; });
    }
  });

  undoLastRepair = action(async () => {
    const undo = this.state.lastRepair;
    if (!undo?.issue.card || !this.state.records) return;
    this.state.repairing = true;
    try {
      const trello = await this.requireTrello();
      await trello.put(
        `/cards/${undo.issue.card.id}`,
        undo.field === 'name'
          ? { name: undo.oldValue }
          : { desc: undo.oldValue },
      );
      const nextRecords = await livestockRecords.fetchRecords(await this.requireTrello());
      runInAction(() => {
        this.state.records = nextRecords;
        this.state.lastRepair = null;
        this.notify('success', 'The previous card repair was undone.');
      });
    } catch (error) {
      runInAction(() => this.notify('error', `Could not undo card repair: ${message(error)}`));
    } finally {
      runInAction(() => { this.state.repairing = false; });
    }
  });

  openIssueInTrello = action(async (issue: ParseIssue) => {
    if (!issue.card) return;
    try {
      const url = await resolveTrelloCardUrl(await this.requireTrello(), issue.card.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      runInAction(() => this.notify('error', `Could not open Trello card: ${message(error)}`));
    }
  });

  loginWithTrello = action(async () => {
    this.state.loading = true;
    try {
      await this.requireTrello();
      runInAction(() => this.setAuthorized(true));
      await this.loadRecords();
    } catch (error) {
      runInAction(() => {
        this.state.loading = false;
        this.notify('error', `Trello login failed: ${message(error)}`);
      });
    }
  });

  logoutTrello = action(async () => {
    try {
      await trelloLibrary.getClient().deauthorize();
    } finally {
      window.location.reload();
    }
  });
}
