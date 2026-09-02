import { createContext } from 'react';
import { state } from './state';
import * as actions from './actions';
import { initialize } from './initialize';

export { state, actions };
export type { AppState, DeadView, HistoryView, DeathDraft } from './state';

export const context = createContext({ state, actions });

void initialize();
