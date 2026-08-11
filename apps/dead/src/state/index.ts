import * as React from 'react';
import { DeadActions } from './actions';
import { state } from './state';

export const actions = new DeadActions(state);
export const context = React.createContext({ state, actions });

export * from './actions';
export * from './state';
