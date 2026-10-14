import { createRoot } from 'react-dom/client';
import { MantineProvider, createTheme } from '@mantine/core';
import '@mantine/core/styles.css';
import '@mantine/dropzone/styles.css';
import './styles/app.css';
import App from './App';

const theme = createTheme({
  primaryColor: 'teal',
  fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
  defaultRadius: 'md',
  components: {
    Slider: { defaultProps: { size: 'sm', label: null } }
  }
});

createRoot(document.getElementById('root')!).render(
  <MantineProvider theme={theme} defaultColorScheme="dark">
    <App />
  </MantineProvider>
);

if (import.meta.env.DEV) {
  import('./store').then(store => Object.assign(window, { __store: store }));
}
