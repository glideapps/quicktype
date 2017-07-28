import React, { Component } from 'react';
import Sidebar from './Sidebar';
import Editor from './Editor';

import urlParse from 'url-parse';

import Main from "../../output/Main";
import Samples from "../../output/Samples";

import 'brace/mode/csharp';
import 'brace/mode/golang';
import 'brace/theme/solarized_dark';

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

  getRenderer = (name) => {
    let theName = name || this.state.rendererName || localStorage["renderer"] || Main.renderers[0].name;
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

  componentDidMount() {
    if (this.state.source === "") {
      this.loadSample();
    } else {
      this.sourceEdited(this.state.source);
    }
  }

  sourceEdited = (source) => {
    let renderer = this.getRenderer();
    let { constructor, value0: output } = this.sendPerformance("Main", "renderJsonString", () => {
      return Main.renderJsonString(renderer)(source);
    });

    this.sendEvent("sourceEdited");

    if (constructor.name === "Left") {
      console.log(output);
      this.setState({ source });
    } else {
      this.setState({ source, output });
    }

    try {
      localStorage["source"] = source;
    } catch (e) {}
  }

  changeRendererName = (rendererName) => {
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
      <main className="mdc-theme--dark mdc-typography">
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
          theme="solarized_dark"
          value={this.state.output}
          showGutter={true}
          />
      </main>
    );
  }
}

export default App;
