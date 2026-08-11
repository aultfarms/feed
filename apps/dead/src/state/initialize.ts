import * as trelloLibrary from '@aultfarms/trello';
import { DeadActions } from './actions';
import { DeadState } from './state';

export async function initialize(state: DeadState, actions: DeadActions): Promise<void> {
  state.loading = true;
  try {
    const authorized = await trelloLibrary.checkAuthorization();
    if (!authorized) {
      state.trelloAuthorized = false;
      state.loading = false;
      return;
    }
    actions.setAuthorized(true);
    await actions.loadRecords();
  } catch (error) {
    state.fatalError = error instanceof Error ? error.message : String(error);
    state.loading = false;
  }
}
