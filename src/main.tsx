import { createRoot } from 'react-dom/client';
import { MantineProvider, createTheme, type MantineColorsTuple } from '@mantine/core';
import '@mantine/core/styles.css';
import '@mantine/dropzone/styles.css';
import './styles/app.css';
import App from './App';

// Warm paper-craft accent.
const clay: MantineColorsTuple = [
  '#fff3ec', '#fde3d5', '#f8c4a8', '#f3a378', '#ee8750',
  '#ec7537', '#eb6b29', '#d15a1c', '#ba4f16', '#a2420e'
];

// Neutral, slightly warm greys for the dark UI.
const dark: MantineColorsTuple = [
  '#d6d4d1', '#b5b3b0', '#8d8b88', '#6b6966', '#3d3c3a',
  '#2d2c2b', '#242322', '#1c1b1a', '#151414', '#0f0e0e'
];

const theme = createTheme({
  primaryColor: 'clay',
  primaryShade: { light: 6, dark: 5 },
  colors: { clay, dark },
  fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
  fontFamilyMonospace: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  defaultRadius: 'md',
  cursorType: 'pointer',
  components: {
    Switch: { defaultProps: { size: 'sm', withThumbIndicator: false } },
    Tooltip: { defaultProps: { withArrow: true, openDelay: 250, fz: 'xs' } },
    ActionIcon: { defaultProps: { variant: 'subtle', color: 'gray' } },
    Popover: { defaultProps: { shadow: 'lg', radius: 'md' } }
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
