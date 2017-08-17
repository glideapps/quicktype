import React, { Component } from 'react';
import Sidebar from './Sidebar';
import Editor from './Editor';
import Snackbar from './Snackbar';
import Button from "@react-mdc/button";

import urlParse from 'url-parse';
import debounce from 'debounce';
import * as _ from "lodash";
import browser from "bowser";

import Main from "../../output/Main";
import Samples from "../../output/Samples";
import { camelCase } from "../../output/Data.String.Util";

import 'brace/mode/csharp';
import 'brace/mode/golang';
import 'brace/mode/typescript';
import 'brace/mode/json';
import 'brace/mode/elm';
import 'brace/theme/chrome';
import 'brace/theme/solarized_dark';

const mobileClass = (browser.mobile || browser.tablet) ? "mobile" : "";

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
      showEditorGutter: true,
      rendererName: preferredRendererName || this.getRenderer().name,
      sampleName,
      topLevelName,
      tab: +localStorage["tab"] || 0
    };
  }

  resize = () => {
    this.setState({
      showEditorGutter: window.innerWidth > 800
    });
  }

  tryGetPreferredRendererExtension = () => {
    // This comes in either as ?l=ext or ?lang=ext
    let { query } = urlParse(window.location.href, true);
    let queryExtension = query.lang || query.l;

    if (queryExtension) return queryExtension;

    // Or on the hostname like java.quicktype.io
    let hostLang = window.location.host.split('.')[0];
    let hostLangRenderer = _.find(Main.renderers, (r) => {
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
    
    let copyButton = window.document.querySelector('.mdc-button--primary');
    copyButton.addEventListener('click', this.copyOutput);

    window.addEventListener('resize', () => {
      this.resize();
    });
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
    return _.find(Main.renderers, { name: theName }) || Main.renderers[0];
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
      this.setState({ source, output }, () => this.resize());
    }

    this.tryStore({source});
  }

  tryStore = (obj) => {
    try {
      for (let key of Object.getOwnPropertyNames(obj)) {
        localStorage[key] = obj[key];
      }
    } catch (e) {}
  }

  changeRendererName = (rendererName) => {
    this.tryStore({renderer: rendererName});

    this.setState({ rendererName }, () => {
      this.editor.scrollTop();
      this.sourceEdited(this.state.source);
    });
  }

  topLevelNameFromSample = (sampleName) => {
    return camelCase(sampleName.split(".")[0]) || "TopLevel";
  }

  changeSampleName = (sampleName) => {
    this.tryStore({sample: sampleName});

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
        this.jsonEditor.scrollTop();
        let source = JSON.stringify(data, null, 2);
        this.setState({ source });
        this.sourceEdited(source);
      });
  }

  render() {
    return (
      <main className="mdc-typography">
          <Sidebar
            sampleName={this.state.sampleName}
            onChangeSample={this.changeSampleName} 
            rendererName={this.state.rendererName}
            onChangeRenderer={this.changeRendererName}
            topLevelName={this.state.topLevelName}
            tab={this.state.tab}
            tabChanged={(tab) => {
              this.tryStore({tab});
              this.setState({tab});
            }}
            onChangeTopLevelName={debounce(this.changeTopLevelName, 300)} />

          <Editor
            ref={(r) => { this.jsonEditor = r; }}
            id="json"
            className={mobileClass}
            lang="json"
            theme="solarized_dark"
            onChange={debounce(this.sourceEdited, 500)}
            value={this.state.source}
            fontSize={(browser.mobile || browser.tablet) ? 12 : 14}
            showGutter={false}
            style={window.innerWidth > 800
            ? {
                visibility: "visible" 
            }
            : {
                visibility: ["visible", "hidden"][this.state.tab] 
            }}
            />

          <Editor
            id="output"
            ref={(r) => { this.editor = r; }}
            lang={this.getRenderer().aceMode}
            theme="chrome"
            value={this.state.output}
            fontSize={(browser.mobile || browser.tablet) ? 13 : 15}
            showGutter={this.state.showEditorGutter}
            style={window.innerWidth > 800
            ? {
                visibility: "visible" 
            }
            : {
                visibility: ["hidden", "visible"][this.state.tab]
            }}
            />
              
          <div id="button-parent" className={mobileClass}>
              <div className="cli-hint">
                  <p>Install quicktype locally:</p>
                  <pre>npm i -g quicktype</pre>
              </div>
              <Button raised primary>
                  Copy {this.props.rendererName}
              </Button>
          </div>

          <Snackbar ref={(r) => { this.snackbar = r; }} />
      </main>
    );
  }
}

export default App;
