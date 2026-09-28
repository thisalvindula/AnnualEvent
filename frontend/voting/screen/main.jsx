import { render, StrictMode } from 'preact/compat';
import './styles.css';
import { App } from './App.jsx';

render(
  <StrictMode>
    <App />
  </StrictMode>,
  document.getElementById('root')
);
