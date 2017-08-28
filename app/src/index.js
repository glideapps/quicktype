import React from 'react';
import ReactDOM from 'react-dom';
import './index.scss';
import App from './App';
import registerServiceWorker from './registerServiceWorker';
import browser from "bowser";
import ReactGA from 'react-ga';

const metadataForHost = {
  "localhost": {
    title: "In development",
    description: "quicktype in development environment"
  },
  "java.quicktype.io": {
    title: "JSON to Java classes and helper code",
    description: "Given JSON sample data, quicktype outputs code for working with that data in Java, Swift, Go, TypeScript, and more."
  },
  "csharp.quicktype.io": {
    title: "JSON to C# classes and helper code",
    description: "Given JSON sample data, quicktype outputs code for working with that data in C#, TypeScript, Go, and more."
  },
  "go.quicktype.io": {
    title: "JSON to Go structs and marshalling helpers",
    description: "Given JSON sample data, quicktype outputs code for working with that data in Go, TypeScript, C#, Elm, and more."
  },
  "elm.quicktype.io": {
    title: "JSON to Elm types and decoders",
    description: "Given JSON sample data, quicktype outputs code for working with that data in Elm, TypeScript, Swift, Go, and more."
  },
  "ts.quicktype.io": {
    title: "JSON to TypeScript interfaces and runtime type-checkers",
    description: "Given JSON sample data, quicktype outputs code for working with that data in TypeScript, C#, Swift, Go, and more."
  },
  "swift.quicktype.io": {
    title: "JSON to Swift types and conversion helpers",
    description: "Given JSON sample data, quicktype outputs code for working with that data in Swift, Java, Go, and more."
  }
};

function setMetadata() {
  let meta = metadataForHost[window.location.hostname];
  if (!meta) return;

  let { title, description } = meta;
  window.document.title = `${title} – quicktype`;
  window.document.querySelector('meta[name="description"]').setAttribute("content", description);
}

function startIntercom() {
  if (browser.mobile || browser.tablet) {
  } else {
    window.Intercom("boot", {
      app_id: "lormewsd"
    });
  }
}

function main() {
  setMetadata();
  startIntercom();

  ReactDOM.render(<App />, document.getElementById('root'));
  registerServiceWorker();
}

main();
