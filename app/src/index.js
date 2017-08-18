import React from 'react';
import ReactDOM from 'react-dom';
import './index.scss';
import App from './App';
import registerServiceWorker from './registerServiceWorker';
import browser from "bowser";
import ReactGA from 'react-ga';
import * as _ from "lodash";

if (_.startsWith(window.location.host, "localhost")) {
  window.ga = () => {};
} else {
  ReactGA.initialize("UA-102732788-1");
}

if (browser.mobile || browser.tablet) {
} else {
  window.Intercom("boot", {
    app_id: "lormewsd"
  });
}

ReactDOM.render(<App />, document.getElementById('root'));
registerServiceWorker();
