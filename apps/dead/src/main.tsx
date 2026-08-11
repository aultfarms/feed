import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { context, state, actions } from './state';
import { initialize } from './state/initialize';
import './index.css';

const theme = createTheme({
  palette: {
    primary: { main: '#b71c1c' },
    secondary: { main: '#455a64' },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
  },
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <context.Provider value={{ state, actions }}>
          <App />
        </context.Provider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

void initialize(state, actions);
