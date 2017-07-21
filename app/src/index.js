import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import App from './App';
import registerServiceWorker from './registerServiceWorker';

window.Intercom("boot", {
  app_id: "lormewsd"
});

ReactDOM.render(<App />, document.getElementById('root'));
registerServiceWorker();
