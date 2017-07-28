import React, { Component } from 'react';
import Sidebar from './Sidebar';
import Editor from './Editor';
import Snackbar from './Snackbar';

import urlParse from 'url-parse';

import Main from "../../output/Main";
import Samples from "../../output/Samples";

import 'brace/mode/csharp';
import 'brace/mode/golang';
import 'brace/mode/json';
import 'brace/theme/chrome';

class App extends Component {
  constructor(props) {
    super(props);

    let { query } = urlParse(window.location.href, true);
    let queryExtension = query.lang || query.l;
    let queryRenderer = queryExtension && Main.renderers.find((r) => r.extension === queryExtension);

    this.state = {
      source: localStorage["source"] || "",
      output: "",
      rendererName: (queryRenderer && queryRenderer.name) || this.getRenderer().name,
      sampleName: localStorage["sample"] || Samples.samples[0]
    };
  }

  componentDidMount() {
    if (this.state.source === "") {
      this.loadSample();
    } else {
      this.sourceEdited(this.state.source);
    }
    
    let copyButton = window.document.querySelector('sidebar .mdc-button--primary');
    copyButton.addEventListener('click', this.copyOutput);
  }

  copyOutput = () => {
    let editor = window.ace.edit("output-editor");
    let savedSelection = editor.selection.toJSON();

    editor.selectAll();
    editor.focus();
    let success = window.document.execCommand('copy');
    editor.selection.fromJSON(savedSelection);

    let message = success
      ? `${this.state.rendererName} code copied`
      : `Could not copy ${this.state.rendererName} code`;

    this.snackbar.show({ message });
  }

  getRenderer = (name) => {
    let currentRenderer = this.state && this.state.rendererName;
    let theName = name || currentRenderer || localStorage["renderer"] || Main.renderers[0].name;
    return Main.renderers.find((r) => r.name === theName) || Main.renderers[0];
  }

  sendEvent = (name, value) => window.ga("send", "event", "App", name, value);

  sendPerformance = (category, variable, work) => {
    let start = window.performance && window.performance.now();
    let result = work();
    let elapsed = start && (window.performance.now() - start);

    if (elapsed) {
      window.ga('send', 'timing', category, variable, Math.round(elapsed));
    }

    return result;
  }

  sourceEdited = (source) => {
    let renderer = this.getRenderer();
    let { constructor, value0: output } = this.sendPerformance("Main", "renderJsonString", () => {
      return Main.renderJsonString(renderer)(source);
    });

    this.sendEvent("sourceEdited");

    if (constructor.name === "Left") {
      this.snackbar.show({
        message: `Error: ${output}`
      });
      this.setState({ source });
    } else {
      this.setState({ source, output });
    }

    try {
      localStorage["source"] = source;
    } catch (e) {}
  }

  changeRendererName = (rendererName) => {
    try {
      localStorage["renderer"] = rendererName;
    } catch (e) {}

    this.setState({ rendererName }, () => {
      this.sourceEdited(this.state.source);
    });
  }

  changeSampleName = (sampleName) => {
    try {
      localStorage["sample"] = sampleName;
    } catch (e) {}

    this.setState({ sampleName }, () => {
      this.loadSample();
    });
  }

  loadSample = () => {
    fetch(`/sample/json/${this.state.sampleName}`)
      .then((data) => data.json())
      .then((data) => {
        let source = JSON.stringify(data, null, 2);
        this.setState({ source });
        this.sourceEdited(source);
      });
  }

  render() {
    return (
      <main className="mdc-typography">
        <Sidebar
          source={this.state.source}
          onChangeSource={this.sourceEdited}
          sampleName={this.state.sampleName}
          onChangeSample={this.changeSampleName} 
          rendererName={this.state.rendererName}
          onChangeRenderer={this.changeRendererName} />
        <Editor
          className="output"
          lang={this.getRenderer().aceMode}
          theme="chrome"
          value={this.state.output}
          showGutter={true}
          />
        <Snackbar
          name="default"
          ref={(r) => { this.snackbar = r; }} />
      </main>
    );
  }
}

export default App;
