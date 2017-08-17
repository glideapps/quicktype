import React from 'react';
import ReactDOM from 'react-dom';
import './index.scss';
import App from './App';
import registerServiceWorker from './registerServiceWorker';
import browser from "bowser";

if (browser.mobile || browser.tablet) {
} else {
  window.Intercom("boot", {
    app_id: "lormewsd"
  });
}

ReactDOM.render(<App />, document.getElementById('root'));
registerServiceWorker();
