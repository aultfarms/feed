import * as React from 'react';
import Alert from '@mui/material/Alert';
import {
  validateCardNameRepair,
  validateConfigCardDescriptionRepair,
  type ConfigKind,
  type LivestockRecords,
  type ParseIssue,
  type RecordKind,
} from '@aultfarms/livestock';

export type IssuesLastRepair = {
  field: 'name' | 'desc';
} | null;

function recordKindForIssue(issue: ParseIssue): RecordKind | null {
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

function groupIssues(issues: ParseIssue[]): ParseIssue[][] {
  const groups = new Map<string, ParseIssue[]>();
  for (const issue of issues) {
    const key = issue.card?.id
      ? `card:${issue.card.id}`
      : `missing:${issue.listName || 'unknown'}:${issue.field || issue.code}`;
    const current = groups.get(key) || [];
    if (!current.some(candidate => (
      candidate.code === issue.code && candidate.message === issue.message
    ))) {
      current.push(issue);
    }
    groups.set(key, current);
  }
  return [...groups.values()];
}

function IssuePanel({
  issues,
  records,
  repairing,
  onRepairIssue,
  onRepairConfigIssue,
  onOpenInTrello,
}: {
  issues: ParseIssue[];
  records: LivestockRecords | null;
  repairing: boolean;
  onRepairIssue: (issue: ParseIssue, newName: string) => Promise<void>;
  onRepairConfigIssue: (issue: ParseIssue, newDescription: string) => Promise<void>;
  onOpenInTrello: (issue: ParseIssue) => Promise<void>;
}) {
  const issue = issues[0]!;
  const metadata = issue.card;
  const recordKind = recordKindForIssue(issue);
  const configKind = configKindForIssue(issue);
  const editsDescription = Boolean(configKind);
  const originalValue = editsDescription
    ? metadata?.raw.description || ''
    : metadata?.raw.name || '';
  const [value, setValue] = React.useState(originalValue);
  const card = metadata ? {
    id: metadata.id,
    idList: metadata.idList,
    name: metadata.raw.name,
    desc: metadata.raw.description,
    dateLastActivity: metadata.dateLastActivity,
  } : null;
  const validation = card && recordKind && records
    ? validateCardNameRepair({
        kind: recordKind,
        card,
        newName: value,
        options: {
          tagColors: records.tagcolors,
          treatmentTypes: records.treatmentTypes,
        },
      })
    : card && configKind
      ? validateConfigCardDescriptionRepair({
          kind: configKind,
          card,
          newDescription: value,
        })
      : null;
  let validationMessage = 'Edit the card to enable validation.';
  let validationClass = '';
  if (!metadata) {
    validationMessage = 'No Trello card metadata is available for this issue.';
    validationClass = 'issuevalidationbad';
  } else if (!recordKind && !configKind) {
    validationMessage = 'This card type cannot be edited here.';
    validationClass = 'issuevalidationbad';
  } else if (validation?.valid) {
    validationMessage = 'This edit parses successfully and can be saved.';
    validationClass = 'issuevalidationgood';
  } else if (validation?.changed) {
    validationMessage = validation.result.issues.find(candidate => candidate.severity === 'error')?.message
      || 'This edit is not valid yet.';
    validationClass = 'issuevalidationbad';
  }

  const save = async () => {
    if (!validation?.valid || !metadata) return;
    const field = editsDescription ? 'description' : 'name';
    if (!window.confirm(`Save this Trello card ${field}?\n\n${metadata.raw.name}`)) return;
    if (configKind) {
      await onRepairConfigIssue(issue, value);
    } else {
      await onRepairIssue(issue, value);
    }
  };

  return (
    <section className="issuecard">
      <div className="issuecardheader">
        <span className="issuelistname">{issue.listName || 'Unknown list'}</span>
        <span className="issuecode">{issues.map(current => current.code).join(', ')}</span>
      </div>
      <div className="issuecardname">
        <strong>Card:</strong> {metadata?.raw.name || '(missing card)'}
      </div>
      <ul className="issuedetails">
        {issues.map((current, index) => (
          <li key={`${current.code}-${index}`}>
            <strong>{current.message}</strong>
            {current.expected && <div>Expected: {current.expected}</div>}
            {current.suggestion && <div>Suggested: {current.suggestion}</div>}
          </li>
        ))}
      </ul>
      {metadata && (recordKind || configKind) && (
        <label className="issueeditorlabel">
          {editsDescription ? 'Trello card description' : 'Trello card name'}
          <textarea
            className={`issueeditor ${editsDescription ? 'issueeditorconfig' : ''}`}
            value={value}
            rows={editsDescription ? 8 : 2}
            spellCheck={false}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
      )}
      <div className={`issuevalidation ${validationClass}`}>{validationMessage}</div>
      {metadata && (
        <div className="issueactivity">
          Last Trello activity: {metadata.dateLastActivity || 'unknown'}
        </div>
      )}
      <div className="issueactions">
        {metadata && (
          <button
            className="issuebutton"
            type="button"
            onClick={() => void onOpenInTrello(issue)}
          >
            Open in Trello
          </button>
        )}
        {metadata && (recordKind || configKind) && (
          <button
            className="issuebutton issuebuttonprimary"
            type="button"
            disabled={!validation?.valid || repairing}
            onClick={() => void save()}
          >
            {repairing ? 'Saving…' : 'Validate and save'}
          </button>
        )}
      </div>
    </section>
  );
}

export function IssuesView({
  issues,
  records,
  repairing,
  lastRepair,
  onRepairIssue,
  onRepairConfigIssue,
  onOpenInTrello,
  onUndoLastRepair,
}: {
  issues: ParseIssue[];
  records: LivestockRecords | null;
  repairing: boolean;
  lastRepair: IssuesLastRepair;
  onRepairIssue: (issue: ParseIssue, newName: string) => Promise<void>;
  onRepairConfigIssue: (issue: ParseIssue, newDescription: string) => Promise<void>;
  onOpenInTrello: (issue: ParseIssue) => Promise<void>;
  onUndoLastRepair: () => Promise<void>;
}) {
  const warnings = issues.filter(issue => issue.severity === 'warning');
  const errorGroups = groupIssues(issues.filter(issue => issue.severity === 'error'));

  return (
    <div className="issuesview history-scroll">
      <div className="issuesheader">
        <strong>Data issues</strong>
        {lastRepair && (
          <button
            className="issuebutton"
            type="button"
            disabled={repairing}
            onClick={() => void onUndoLastRepair()}
          >
            Undo last edit
          </button>
        )}
      </div>
      {warnings.length > 0 && (
        <Alert severity="info">
          {warnings.length} historical normalization warning{warnings.length === 1 ? '' : 's'} were retained
          for audit purposes. They do not block valid records.
        </Alert>
      )}
      {errorGroups.length === 0 ? (
        <Alert severity="success">All Trello record cards parse successfully.</Alert>
      ) : (
        <>
          <Alert severity="warning">
            {errorGroups.length} invalid card{errorGroups.length === 1 ? '' : 's'} were excluded from records
            and analytics. Valid cards are still available.
          </Alert>
          <div className="issuelist">
            {errorGroups.map((grouped, index) => (
              <IssuePanel
                key={`${grouped[0]?.card?.id || 'missing'}-${index}`}
                issues={grouped}
                records={records}
                repairing={repairing}
                onRepairIssue={onRepairIssue}
                onRepairConfigIssue={onRepairConfigIssue}
                onOpenInTrello={onOpenInTrello}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
