import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { Helmet, HelmetProvider } from 'react-helmet-async';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  groupForTag,
  sameTag,
  type DeadRecord,
  type LivestockRecords,
  type Tag,
} from '@aultfarms/livestock';
import pkg from '../package.json';
import { context, type DeadView } from './state';
import { DeadAnalytics, GroupMortality } from './Analytics';
import { Issues } from './Issues';
import './App.css';

const views: Array<{ value: DeadView; label: string }> = [
  { value: 'prefs', label: '☰' },
  { value: 'date', label: 'Date' },
  { value: 'tag', label: 'Tag' },
  { value: 'groups', label: 'Groups' },
  { value: 'trends', label: 'Trends' },
  { value: 'issues', label: 'Issues' },
];

function utcDay(date: string): number {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function daysBetween(start: string, end: string): number {
  return utcDay(end) - utcDay(start);
}

function daysAgo(date: string): number {
  return utcDay(new Date().toISOString().slice(0, 10)) - utcDay(date);
}

function durationText(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function selectedTagColor(colorName: string, colors: Record<string, string>): string {
  return colors[colorName] || '#444444';
}

const TagBar = observer(function TagBar() {
  const { state, actions } = React.useContext(context);
  const colors = state.records?.tagcolors || {};
  const color = selectedTagColor(state.draft.tag.color, colors);

  return (
    <div className="tagbar" style={{ borderColor: state.dirty ? 'red' : '#CCCCCC' }}>
      <input
        aria-label="Tag color"
        className="colortext"
        style={{ color, borderColor: color }}
        value={state.draft.tag.color}
        type="text"
        onChange={(event) => actions.changeDraft({
          tag: { ...state.draft.tag, color: event.target.value.toUpperCase() },
        })}
      />
      <input
        aria-label="Tag number"
        className="numbertext"
        value={state.draft.tag.number || ''}
        type="text"
        inputMode="numeric"
        onChange={(event) => actions.changeDraft({
          tag: {
            ...state.draft.tag,
            number: Number(event.target.value.replace(/\D/g, '')) || 0,
          },
        })}
      />
    </div>
  );
});

const Message = observer(function Message() {
  const { state } = React.useContext(context);
  const message = state.snackbar.text || state.fatalError;
  const type = state.snackbar.type === 'error' || state.snackbar.type === 'warning' || state.fatalError
    ? 'bad'
    : 'good';
  return <div className={`msg msg${type}`}>{message}</div>;
});

const HistorySelector = observer(function HistorySelector({
  loadingView,
  onSelect,
}: {
  loadingView: DeadView | null;
  onSelect: (view: DeadView) => void;
}) {
  const { state } = React.useContext(context);
  const issueCount = state.records?.issues?.filter(issue => issue.severity === 'error').length || 0;

  return (
    <div className="historyselector" role="tablist" aria-label="History views">
      {views.map(view => (
        <button
          className={`historyselectorbutton ${
            state.view === view.value ? 'historyselectorbuttonactive' : ''
          }`}
          key={view.value}
          type="button"
          role="tab"
          aria-selected={state.view === view.value}
          aria-label={view.value === 'prefs' ? 'Menu' : undefined}
          onClick={() => onSelect(view.value)}
        >
          {view.label}
          {loadingView === view.value && (
            <span className="tabspinner" role="status" aria-label={`Loading ${view.label}`} />
          )}
          {view.value === 'issues' && issueCount > 0 ? ` (${issueCount})` : ''}
        </button>
      ))}
    </div>
  );
});

const Preferences = observer(function Preferences() {
  const { state, actions } = React.useContext(context);
  const issueCount = state.records?.issues?.filter(issue => issue.severity === 'error').length || 0;

  return (
    <div className="prefs">
      <button className="prefslink" type="button" onClick={() => void actions.loadRecords()}>
        Refresh records
      </button>
      <button className="prefslink" type="button" onClick={() => void actions.logoutTrello()}>
        Change Trello Account
      </button>
      <p className="prefsinfo">Dead App Version {pkg.version}</p>
      <p className="prefsinfo">{issueCount} invalid Trello card{issueCount === 1 ? '' : 's'}</p>
    </div>
  );
});

function DeadCalfCard({
  records,
  record,
  tag,
}: {
  records: LivestockRecords;
  record: DeadRecord;
  tag: Tag;
}) {
  const group = groupForTag(records, tag, record.date);
  const treatments = records.treatments.records
    .filter(treatment => treatment.date <= record.date)
    .filter(treatment => treatment.tags.some(candidate => sameTag(candidate, tag)))
    .filter(treatment => {
      const treatmentGroup = groupForTag(records, tag, treatment.date);
      return (!group && !treatmentGroup)
        || Boolean(group && treatmentGroup && group.groupname === treatmentGroup.groupname);
    })
    .sort((left, right) => right.date.localeCompare(left.date));
  const groupDeaths = group
    ? records.dead.records.reduce((total, death) => (
        total + death.tags.filter(candidate => {
          const candidateGroup = groupForTag(records, candidate, death.date);
          return candidateGroup && candidateGroup.groupname === group.groupname;
        }).length
      ), 0)
    : 0;
  const mortality = group && group.head ? (groupDeaths / group.head) * 100 : null;
  const daysOnFeed = group ? daysBetween(group.date, record.date) : null;
  let groupClass = 'calfcardgoodgroup';
  if (mortality !== null && mortality >= 10) groupClass = 'calfcardmoderategroup';
  if (mortality !== null && mortality >= 20) groupClass = 'calfcardbadgroup';

  return (
    <div className="calfcard">
      <div className="calfcardheader">
        <span
          className="calfcardcolortext"
          style={{ color: selectedTagColor(tag.color, records.tagcolors) }}
        >
          {tag.color}{tag.number}:&nbsp;
        </span>
        {treatments.length} treatments,&nbsp;
        {daysOnFeed === null
          ? 'unknown time onsite.'
          : `${daysOnFeed} day${daysOnFeed === 1 ? '' : 's'} onsite.`}
      </div>
      {record.note && <div className="calfcardnote">{record.note}</div>}
      {group ? (
        <div className={`calfcardgroupinfo ${groupClass}`}>
          {group.groupname}:&nbsp;
          {groupDeaths} head
          {mortality === null ? '' : ` (${mortality.toFixed(2)}%)`} dead
        </div>
      ) : (
        <div className="calfcardgroupinfo calfcardbadgroup">Group unknown</div>
      )}
      <div className="calfcardtreatments">
        {treatments.map(treatment => (
          <div className="calfcardtreatment" key={treatment.id}>
            <span>{treatment.treatment}</span>
            <span>{treatment.date} ({daysBetween(treatment.date, record.date)}d before)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const DateHistory = observer(function DateHistory() {
  const { state } = React.useContext(context);
  const records = state.records;
  const dateRecords = records?.dead.records
    .filter(record => record.date === state.draft.date)
    .sort((left, right) => right.dateLastActivity.localeCompare(left.dateLastActivity)) || [];
  const total = dateRecords.reduce((sum, record) => sum + record.tags.length, 0);

  return (
    <div className="history">
      <div className="historytitle">{state.draft.date}: {total} DEAD total.</div>
      {records && dateRecords.flatMap(record => (
        record.tags.map((tag, index) => (
          <DeadCalfCard
            key={`${record.id}-${tag.color}${tag.number}-${index}`}
            records={records}
            record={record}
            tag={tag}
          />
        ))
      ))}
    </div>
  );
});

const TagHistory = observer(function TagHistory() {
  const { state } = React.useContext(context);
  const records = state.records;
  if (!records || !state.draft.tag.color || state.draft.tag.number < 1) {
    return <div className="historytag" />;
  }

  const selectedGroup = groupForTag(records, state.draft.tag, state.draft.date);
  const inSameAnimal = (tag: Tag, date: string) => {
    if (!sameTag(tag, state.draft.tag)) return false;
    const group = groupForTag(records, tag, date);
    return (!selectedGroup && !group)
      || Boolean(selectedGroup && group && selectedGroup.groupname === group.groupname);
  };
  const treatments = records.treatments.records
    .filter(record => record.tags.some(tag => inSameAnimal(tag, record.date)))
    .sort((left, right) => right.date.localeCompare(left.date));
  const death = records.dead.records
    .filter(record => record.tags.some(tag => inSameAnimal(tag, record.date)))
    .sort((left, right) => right.date.localeCompare(left.date))[0];

  let previousDays = -1;
  return (
    <div className="historytag">
      <div className="historyheader">
        {treatments.length} Treatments
        {selectedGroup ? `, ${selectedGroup.groupname}` : ''}
      </div>
      {death && <div className="historyerror">Already died on {death.date}!</div>}
      {treatments.map(record => {
        const days = daysAgo(record.date);
        const gap = previousDays < 0 ? '' : ` (+${days - previousDays})`;
        previousDays = days;
        return (
          <div className="historytagentry" key={`${record.id}-${record.date}`}>
            <div className="historytreatment">{record.treatment}</div>
            <div className="historyduration">{durationText(days)}{gap}</div>
          </div>
        );
      })}
    </div>
  );
});

function DeferredAnalyticsView({
  view,
  onLoaded,
}: {
  view: 'groups' | 'trends';
  onLoaded: () => void;
}) {
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let timer: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      timer = window.setTimeout(() => setReady(true), 0);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  React.useEffect(() => {
    if (!ready) return undefined;
    const frame = window.requestAnimationFrame(onLoaded);
    return () => window.cancelAnimationFrame(frame);
  }, [onLoaded, ready]);

  if (!ready) {
    return (
      <div className="historyloading" role="status">
        <span className="tabspinner" aria-hidden="true" />
        Loading {view}…
      </div>
    );
  }
  return view === 'groups' ? <GroupMortality /> : <DeadAnalytics />;
}

const History = observer(function History({
  onHeavyViewLoaded,
}: {
  onHeavyViewLoaded: () => void;
}) {
  const { state } = React.useContext(context);

  if (state.view === 'prefs') return <Preferences />;
  if (state.view === 'date') return <DateHistory />;
  if (state.view === 'tag') return <TagHistory />;
  if (state.view === 'groups' || state.view === 'trends') {
    return (
      <DeferredAnalyticsView
        key={state.view}
        view={state.view}
        onLoaded={onHeavyViewLoaded}
      />
    );
  }
  return <Issues />;
});

const TagPane = observer(function TagPane() {
  const { state, actions } = React.useContext(context);
  const [loadingView, setLoadingView] = React.useState<DeadView | null>(null);
  const selectView = React.useCallback((view: DeadView) => {
    if (view === state.view) return;
    setLoadingView(view === 'groups' || view === 'trends' ? view : null);
    actions.setView(view);
  }, [actions, state.view]);
  const heavyViewLoaded = React.useCallback(() => setLoadingView(null), []);
  return (
    <div className="tagpane">
      <TagBar />
      <Message />
      <HistorySelector loadingView={loadingView} onSelect={selectView} />
      <History onHeavyViewLoaded={heavyViewLoaded} />
    </div>
  );
});

function Keypad({
  onNumber,
  onClear,
  onBackspace,
}: {
  onNumber: (number: number) => void;
  onClear: () => void;
  onBackspace: () => void;
}) {
  const rows: Array<Array<number | { label: string; action: () => void }>> = [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
    [
      { label: 'C', action: onClear },
      0,
      { label: '<--', action: onBackspace },
    ],
  ];

  return (
    <div className="keypad">
      {rows.map((row, rowIndex) => (
        <div className="keypadrow" key={rowIndex}>
          {row.map(item => {
            const label = typeof item === 'number' ? String(item) : item.label;
            return (
              <button
                className="keypadbutton"
                key={label}
                type="button"
                aria-label={label === '<--' ? 'Backspace tag number' : undefined}
                onClick={() => (typeof item === 'number' ? onNumber(item) : item.action())}
              >
                {label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const RecordInput = observer(function RecordInput() {
  const { state, actions } = React.useContext(context);
  const colors = state.records?.tagcolors || {};
  const canSave = Boolean(
    state.records
    && state.draft.tag.number
    && state.draft.tag.color
    && !state.saving,
  );

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (/^[0-9]$/.test(event.key)) {
        actions.appendTagDigit(Number(event.key));
        event.preventDefault();
        return;
      }
      if (event.key === 'Backspace') {
        actions.backspaceTagNumber();
        event.preventDefault();
        return;
      }
      const shortcuts: Record<string, string> = {
        y: 'YELLOW',
        g: 'GREEN',
        b: 'BLUE',
        r: 'RED',
        p: 'PURPLE',
        w: 'WHITE',
        n: 'NOTAG',
      };
      const color = shortcuts[event.key.toLowerCase()];
      if (color) {
        actions.changeDraft({ tag: { ...state.draft.tag, color } });
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [actions, state.draft.tag]);

  return (
    <div className="recordinput">
      <div className="colorbar">
        {Object.entries(colors)
          .filter(([name]) => name !== 'NOTAG')
          .map(([name, color]) => (
            <button
              aria-label={`Select ${name} tag`}
              className="colorbutton"
              key={name}
              title={name}
              type="button"
              onClick={() => actions.changeDraft({
                tag: { ...state.draft.tag, color: name },
              })}
              style={{ backgroundColor: color }}
            />
          ))}
        <button
          aria-label="Select untagged animal"
          className="colorbutton colorbutton-notag"
          title="NOTAG"
          type="button"
          onClick={() => actions.changeDraft({
            tag: { ...state.draft.tag, color: 'NOTAG', number: state.draft.tag.number || 1 },
          })}
        />
      </div>
      <div className="datebar">
        <input
          aria-label="Death date"
          className="dateinput"
          value={state.draft.date}
          type="date"
          onChange={(event) => actions.changeDraft({ date: event.target.value })}
        />
        <input
          aria-label="Optional note"
          className="noteinput"
          value={state.draft.note}
          type="text"
          placeholder="Optional note"
          onChange={(event) => actions.changeDraft({ note: event.target.value })}
        />
      </div>
      <Keypad
        onNumber={actions.appendTagDigit}
        onClear={actions.clearTag}
        onBackspace={actions.backspaceTagNumber}
      />
      {state.pendingDuplicate && (
        <div className="duplicatewarning">
          <span>
            Already recorded dead on {state.pendingDuplicate.record.date}. Nothing was written.
          </span>
          {state.pendingDuplicate.record.date !== state.pendingDuplicate.requestedDate && (
            <button
              type="button"
              disabled={state.saving}
              onClick={() => void actions.saveDeath(true)}
            >
              Save anyway
            </button>
          )}
        </div>
      )}
      <div
        className={`savebutton ${canSave ? 'savebuttonenabled' : 'savebuttondisabled'}`}
        role="button"
        tabIndex={canSave ? 0 : -1}
        aria-disabled={!canSave}
        onClick={() => {
          if (canSave) void actions.saveDeath();
        }}
        onKeyDown={(event) => {
          if (canSave && (event.key === 'Enter' || event.key === ' ')) {
            void actions.saveDeath();
          }
        }}
      >
        {state.saving ? 'SAVING DEAD' : 'SAVE DEAD'}
      </div>
    </div>
  );
});

const LegacyApplication = observer(function LegacyApplication() {
  const { state } = React.useContext(context);
  const analyticsView = state.view === 'groups' || state.view === 'trends';
  return (
    <div className={`App ${analyticsView ? 'analyticsview' : ''}`}>
      <TagPane />
      {!analyticsView && <RecordInput />}
    </div>
  );
});

export const App = observer(function App() {
  const { state, actions } = React.useContext(context);

  React.useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [state.dirty]);

  let content: React.ReactNode;
  if (state.loading) {
    content = (
      <Stack className="loading-screen" alignItems="center" spacing={1}>
        <CircularProgress />
        <Typography>Loading Livestock board…</Typography>
      </Stack>
    );
  } else if (!state.trelloAuthorized) {
    content = (
      <Stack className="loading-screen" alignItems="center" spacing={1}>
        <Alert severity="info">Log in with Trello to load and save mortality records.</Alert>
        <Button variant="contained" onClick={() => void actions.loginWithTrello()}>
          Login with Trello
        </Button>
      </Stack>
    );
  } else if (state.fatalError && !state.records) {
    content = (
      <Stack className="loading-screen" spacing={2}>
        <Alert severity="error">{state.fatalError}</Alert>
        <Button variant="contained" onClick={() => void actions.loadRecords()}>Retry</Button>
      </Stack>
    );
  } else {
    content = <LegacyApplication />;
  }

  return (
    <HelmetProvider>
      <Helmet><title>AF/Dead - v{pkg.version}</title></Helmet>
      {content}
    </HelmetProvider>
  );
});
