import React, { Component } from 'react';
import Sidebar from './Sidebar';
import Editor from './Editor';
import Snackbar from './Snackbar';

import urlParse from 'url-parse';
import debounce from 'debounce';

import Main from "../../output/Main";
import Samples from "../../output/Samples";
import { camelCase } from "../../output/Data.String.Util";

import 'brace/mode/csharp';
import 'brace/mode/golang';
import 'brace/mode/typescript';
import 'brace/mode/json';
import 'brace/mode/elm';
import 'brace/theme/chrome';

class App extends Component {
  constructor(props) {
    super(props);

    let preferredExtension = this.tryGetPreferredRendererExtension();
    let preferredRenderer = preferredExtension && Main.renderers.find((r) => r.extension === preferredExtension);
    let preferredRendererName = preferredRenderer && preferredRenderer.name;

    let sampleName = localStorage["sample"] || Samples.samples[0];
    let topLevelName = this.topLevelNameFromSample(sampleName);
    
    this.state = {
      source: localStorage["source"] || "",
      output: "",
      rendererName: preferredRendererName || this.getRenderer().name,
      sampleName,
      topLevelName
    };
  }

  tryGetPreferredRendererExtension = () => {
    // This comes in either as ?l=ext or ?lang=ext
    let { query } = urlParse(window.location.href, true);
    let queryExtension = query.lang || query.l;

    if (queryExtension) return queryExtension;

    // Or on the hostname like java.quicktype.io
    let hostLang = window.location.host.split('.')[0];
    let hostLangRenderer = Main.renderers.find((r) => {
      // Match extension or the aceMode (e.g. 'cs' or 'csharp')
      return r.extension === hostLang || r.aceMode === hostLang;
    });
    let hostExtension = hostLangRenderer && hostLangRenderer.extension;

    return hostExtension;
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
    editor.blur();
    editor.selection.fromJSON(savedSelection);

    let message = success
      ? `${this.state.rendererName} copied`
      : `Could not copy code`;

    setImmediate(() => {
      document.activeElement.blur();
      setTimeout(() => {
        this.snackbar.show({ message });
      }, 100);
    });
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
    let { constructor, value0: output } = this.sendPerformance("Main", "renderJsonString", () => {
      return Main.renderFromJsonStringPossiblyAsSchemaInDevelopment(this.state.topLevelName)({
        input: source,
        renderer: this.getRenderer()
      });
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

  topLevelNameFromSample = (sampleName) => {
    return camelCase(sampleName.split(".")[0]) || "TopLevel";
  }

  changeSampleName = (sampleName) => {
    try {
      localStorage["sample"] = sampleName;
    } catch (e) {}

    let topLevelName = this.topLevelNameFromSample(sampleName);
    this.setState({ sampleName, topLevelName }, () => {
      this.loadSample();
    });
  }

  changeTopLevelName = (topLevelName) => {
    this.setState({ topLevelName }, () => {
      this.sourceEdited(this.state.source);
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
      <main className="mdc-typography mdc-layout-grid">
        <div className="mdc-layout-grid__inner">
            <Sidebar
              className="mdc-layout-grid__cell mdc-layout-grid__cell--span-4"
              source={this.state.source}
              onChangeSource={this.sourceEdited}
              sampleName={this.state.sampleName}
              onChangeSample={this.changeSampleName} 
              rendererName={this.state.rendererName}
              onChangeRenderer={this.changeRendererName}
              topLevelName={this.state.topLevelName}
              onChangeTopLevelName={debounce(this.changeTopLevelName, 300)} />
            <Editor
              id="output"
              className="mdc-layout-grid__cell mdc-layout-grid__cell--span-8"
              lang={this.getRenderer().aceMode}
              theme="chrome"
              value={this.state.output}
              showGutter={true}
              />
            <Snackbar ref={(r) => { this.snackbar = r; }} />
          </div>
      </main>
    );
  }
}

export default App;
