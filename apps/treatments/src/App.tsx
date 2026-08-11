import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { Helmet, HelmetProvider } from 'react-helmet-async';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  groupForTag,
  sameTag,
  tokenizeTreatmentProtocol,
} from '@aultfarms/livestock';
import pkg from '../package.json';
import { context, type HistoryView } from './state';
import { Issues } from './Issues';
import { GroupOutcomes, TreatmentAnalytics } from './Analytics';
import './App.css';

const views: Array<{ value: HistoryView; label: string }> = [
  { value: 'prefs', label: '☰' },
  { value: 'date', label: 'Date' },
  { value: 'tag', label: 'Tag' },
  { value: 'groups', label: 'Groups' },
  { value: 'trends', label: 'Trends' },
  { value: 'issues', label: 'Issues' },
];

function selectedTagColor(colorName: string, colors: Record<string, string>): string {
  return colors[colorName] || '#444444';
}

function utcDay(date: string): number {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function daysAgo(date: string): number {
  return utcDay(new Date().toISOString().slice(0, 10)) - utcDay(date);
}

function durationText(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
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
  const type = state.snackbar.type === 'error' || state.fatalError ? 'bad' : 'good';
  return <div className={`msg msg${type}`}>{message}</div>;
});

const HistorySelector = observer(function HistorySelector({
  loadingView,
  onSelect,
}: {
  loadingView: HistoryView | null;
  onSelect: (view: HistoryView) => void;
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
      <p className="prefsinfo">Treatments App Version {pkg.version}</p>
      <p className="prefsinfo">{issueCount} invalid Trello card{issueCount === 1 ? '' : 's'}</p>
    </div>
  );
});

const DateHistory = observer(function DateHistory() {
  const { state } = React.useContext(context);
  const records = state.records?.treatments.records
    .filter(record => record.date === state.draft.date)
    .sort((left, right) => right.dateLastActivity.localeCompare(left.dateLastActivity)) || [];
  const total = records.reduce((sum, record) => sum + record.tags.length, 0);

  return (
    <div className="history">
      <div className="historytitle">{state.draft.date}: {total} head total.</div>
      {records.map(record => (
        <div className="treatmentcard" key={record.id}>
          <div className="treatmentcardcount">{record.tags.length} head</div>
          -
          <div className="treatmentcardtreatment">{record.treatment}</div>
          <div className="treatmentcardtags">
            {record.tags.map((tag, index) => (
              <div className="treatmentcardtag" key={`${tag.color}${tag.number}-${index}`}>
                {tag.color}{tag.number}
              </div>
            ))}
          </div>
        </div>
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
  const history = records.treatments.records
    .flatMap(record => (
      record.tags
        .filter(tag => sameTag(tag, state.draft.tag))
        .filter(tag => {
          const group = groupForTag(records, tag, record.date);
          return (!selectedGroup && !group)
            || Boolean(selectedGroup && group && selectedGroup.groupname === group.groupname);
        })
        .map(() => record)
    ))
    .sort((left, right) => right.date.localeCompare(left.date));

  let previousDays = -1;
  return (
    <div className="historytag">
      {history.map(record => {
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
  return view === 'groups' ? <GroupOutcomes /> : <TreatmentAnalytics />;
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
  const [loadingView, setLoadingView] = React.useState<HistoryView | null>(null);
  const fullWidthView = state.view === 'groups' || state.view === 'trends' || state.view === 'issues';
  const selectView = React.useCallback((view: HistoryView) => {
    if (view === state.view) return;
    setLoadingView(view === 'groups' || view === 'trends' ? view : null);
    actions.setView(view);
  }, [actions, state.view]);
  const heavyViewLoaded = React.useCallback(() => setLoadingView(null), []);

  return (
    <div className={`tagpane ${fullWidthView ? 'tagpane-full' : ''}`}>
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

const TreatmentEditor = observer(function TreatmentEditor({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { state, actions } = React.useContext(context);
  const treatmentTypes = state.records?.treatmentTypes || [];
  const tokenized = tokenizeTreatmentProtocol(state.draft.treatment, treatmentTypes);
  const selectedCodes = new Set(tokenized.tokens.map(token => token.code));
  const recent = state.records?.treatments.records
    .slice()
    .sort((left, right) => right.dateLastActivity.localeCompare(left.dateLastActivity))
    .reduce<string[]>((result, record) => {
      if (!result.includes(record.treatment) && result.length < 5) result.push(record.treatment);
      return result;
    }, []) || [];

  const toggleCode = (code: string) => {
    const found = tokenized.tokens.find(token => token.code === code);
    const treatment = found
      ? `${state.draft.treatment.slice(0, found.start)}${state.draft.treatment.slice(found.end)}`
      : `${state.draft.treatment}${code}`;
    actions.changeDraft({ treatment });
  };

  return (
    <Dialog
      className="legacy-treatment-dialog"
      fullScreen
      open={open}
      onClose={onClose}
    >
      <div className="treatmentEditor">
        <input
          aria-label="Treatment protocol"
          className={`treatmentEditorTextInput ${tokenized.unknown.length ? 'treatmentEditorTextInputError' : ''}`}
          type="text"
          value={state.draft.treatment}
          onChange={(event) => actions.changeDraft({ treatment: event.target.value })}
        />
        <div className="treatmentCodesList">
          {treatmentTypes.map(type => (
            <button
              className={`treatmentCodeButton ${
                selectedCodes.has(type.code) ? 'codeOn' : 'codeOff'
              }`}
              key={type.code}
              type="button"
              onClick={() => toggleCode(type.code)}
            >
              <span className="treatmentCodeButtonCode">{type.code}</span>
              <span className="treatmentCodeButtonName">{type.name}</span>
            </button>
          ))}
        </div>
        <div className="recentTreatmentsList">
          <div className="recentText">Recent:</div>
          {recent.map(protocol => (
            <button
              className="recentTreatmentsButton"
              key={protocol}
              type="button"
              onClick={() => actions.changeDraft({ treatment: protocol })}
            >
              {protocol}
            </button>
          ))}
        </div>
        <button className="treatmentEditorDoneButton" type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
});

const RecordInput = observer(function RecordInput() {
  const { state, actions } = React.useContext(context);
  const [treatmentEditorOpen, setTreatmentEditorOpen] = React.useState(false);
  const colors = state.records?.tagcolors || {};
  const tokenized = tokenizeTreatmentProtocol(
    state.draft.treatment,
    state.records?.treatmentTypes || [],
  );
  const canSave = Boolean(
    state.records
    && state.draft.tag.number
    && state.draft.tag.color
    && state.draft.treatment
    && tokenized.unknown.length === 0
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
      <div className="treatmentdatebar">
        <input
          aria-label="Treatment date"
          className="treatmentdateinput"
          value={state.draft.date}
          type="date"
          onChange={(event) => actions.changeDraft({ date: event.target.value })}
        />
        <input
          aria-label="Treatment protocol"
          className="treatmentstring"
          value={state.draft.treatment}
          type="text"
          readOnly
          onClick={() => setTreatmentEditorOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') setTreatmentEditorOpen(true);
          }}
        />
      </div>
      <Keypad
        onNumber={actions.appendTagDigit}
        onClear={actions.clearTag}
        onBackspace={actions.backspaceTagNumber}
      />
      <div
        className={`savebutton ${canSave ? 'savebuttonenabled' : 'savebuttondisabled'}`}
        role="button"
        tabIndex={canSave ? 0 : -1}
        aria-disabled={!canSave}
        onClick={() => {
          if (canSave) void actions.saveTreatment();
        }}
        onKeyDown={(event) => {
          if (canSave && (event.key === 'Enter' || event.key === ' ')) {
            void actions.saveTreatment();
          }
        }}
      >
        {state.saving ? 'SAVING TREATMENT' : 'SAVE TREATMENT'}
      </div>
      <TreatmentEditor open={treatmentEditorOpen} onClose={() => setTreatmentEditorOpen(false)} />
    </div>
  );
});

const LegacyApplication = observer(function LegacyApplication() {
  const { state } = React.useContext(context);
  const showEntry = state.view === 'date' || state.view === 'tag' || state.view === 'prefs';

  return (
    <div className="App">
      <TagPane />
      {showEntry && <RecordInput />}
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
        <Alert severity="info">Log in with Trello to load and save treatment records.</Alert>
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
      <Helmet><title>AF/Treatments - v{pkg.version}</title></Helmet>
      {content}
    </HelmetProvider>
  );
});
