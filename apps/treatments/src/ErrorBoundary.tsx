import * as React from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';

type State = {
  error: Error | null;
};

export class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <Stack spacing={2} sx={{ p: 3 }}>
        <Alert severity="error">
          The Treatments app could not render: {this.state.error.message}
        </Alert>
        <Button variant="contained" onClick={() => window.location.reload()}>
          Reload app
        </Button>
      </Stack>
    );
  }
}
