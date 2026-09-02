import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { IssuesView } from '@aultfarms/livestock-ui';
import { context } from './state';

export const Issues = observer(function Issues() {
  const { state, actions } = React.useContext(context);
  return (
    <IssuesView
      issues={state.records?.issues || []}
      records={state.records}
      repairing={state.repairing}
      lastRepair={state.lastRepair}
      onRepairIssue={actions.repairIssue}
      onRepairConfigIssue={actions.repairConfigIssue}
      onOpenInTrello={actions.openIssueInTrello}
      onUndoLastRepair={actions.undoLastRepair}
    />
  );
});
