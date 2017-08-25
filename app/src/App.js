import React, { Component } from 'react';
import Sidebar from './Sidebar';
import Editor from './Editor';
import Snackbar from './Snackbar';
import Button from "@react-mdc/button";

import urlParse from 'url-parse';
import * as _ from "lodash";
import browser from "bowser";
import classNames from "classnames";
import { hashCode } from "hashcode";

import Main from "../../output/Main";
import Samples from "../../output/Samples";

// eslint-disable-next-line import/no-webpack-loader-syntax
import Worker from "worker-loader?name=static/js/worker.[hash].js!./worker.js";

import { camelCase } from "../../output/Data.String.Util";

import 'brace/mode/csharp';
import 'brace/mode/golang';
import 'brace/mode/typescript';
import 'brace/mode/java';
import 'brace/mode/json';
import 'brace/mode/elm';
import 'brace/mode/groovy';
import 'brace/theme/chrome';
import 'brace/theme/solarized_dark';

const isMobile = browser.mobile || browser.tablet;
const mobileClass = isMobile ? "mobile" : "";

class App extends Component {
  constructor(props) {
    super(props);

    this.worker = new Worker();
    this.worker.onmessage = message => this.onWorkerResult(message);

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
      sampleLoading: false,
      outputLoading: true,
      tab: +localStorage["tab"] || 0
    };
  }

  resize = () => {
    this.setState({
      showEditorGutter: window.innerWidth > 1000
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

    this.resize();
  }

  copyOutput = () => {
    let editor = window.ace.edit("output-editor");
    let savedSelection = editor.selection.toJSON();

    editor.selectAll();
    editor.focus();
    let success = window.document.execCommand('copy');
    editor.blur();
    editor.selection.fromJSON(savedSelection);

    setImmediate(() => {
      document.activeElement.blur();

      if (success) return;

      setTimeout(() => {
        this.snackbar.show({ message: `⚠️ Could not copy code` });
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

  displayRenderError(message) {
    this.snackbar.show({
      message: `⚠️ ${message}`,
      timeout: 10000
    });
  }

  displayRenderErrorDebounced = _.debounce(this.displayRenderError, 1000)

  getRenderStateReceipt = () => {
    return hashCode().value({
      source: this.state.source,
      language: this.getRenderer().name,
      topLevelName: this.state.topLevelName
    });
  }

  sourceEdited = source => {
    this.tryStore({ source });
    this.setState({ source });

    this.displayRenderErrorDebounced.cancel();
    this.snackbar.hide();

    // For some reason, our renderer sometimes indicates
    // a successful result, but the 'source code' is a JSON parse
    // error. If we cannot parse the source as JSON, let's indicate this.
    // TODO: fix this in Main.purs
    let sampleObject = {};
    try {
      sampleObject = JSON.parse(source);
    } catch (e) {
      this.displayRenderErrorDebounced(e);
      this.setState({ outputLoading: false });
      return;
    }

    let renderState = {
      sampleObject,
      language: this.getRenderer().name,
      topLevelName: this.state.topLevelName,
      receipt: this.getRenderStateReceipt()
    };

    this.worker.postMessage(renderState);
  }

  sourceEditedDebounced = _.debounce(this.sourceEdited, 400)

  onWorkerResult = message => {
    let { receipt, result } = message.data;

    // If state changed during the await, abort.
    if (!_.isEqual(receipt, this.getRenderStateReceipt())) return;
    
    this.setState({ outputLoading: false });

    let { constructor, value0: output } = result;

    if (constructor.name === "Left") {
      this.displayRenderError(output);
    } else {
      this.setState({ output });
    }
  }

  tryStore = (obj) => {
    try {
      for (let key of Object.getOwnPropertyNames(obj)) {
        localStorage[key] = obj[key];
      }
    } catch (e) {}
  }

  changeRendererName = (rendererName) => {
    this.tryStore({ renderer: rendererName });
    this.setState({ rendererName, outputLoading: true }, () => {
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
    this.setState({ sampleName, topLevelName, outputLoading: true, sampleLoading: true }, () => {
      this.loadSample();
    });
  }

  changeTopLevelName = (topLevelName) => {
    this.setState({ topLevelName }, () => {
      this.sourceEditedDebounced(this.state.source);
    });
  }

  loadSample = () => {
    fetch(`/sample/json/${this.state.sampleName}`)
      .then((data) => data.json())
      .then((data) => {
        this.editor.scrollTop();
        this.jsonEditor.scrollTop();

        let source = JSON.stringify(data, null, 2);
        this.sourceEdited(source);

        this.setState({ sampleLoading: false });
      });
  }

  render() {
    return (
      <main className="mdc-typography">
          <Sidebar
            loading={this.state.outputLoading || this.state.sampleLoading}
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
            onChangeTopLevelName={this.changeTopLevelName} />

          <Editor
            ref={(r) => { this.jsonEditor = r; }}
            id="json"
            className={classNames("fadeable", {
              mobile: isMobile,
              fade: this.state.sampleLoading
            })}
            lang="json"
            theme="solarized_dark"
            onChange={this.sourceEditedDebounced}
            value={this.state.source}
            fontSize={(browser.mobile || browser.tablet) ? 12 : 14}
            tabSize={2}
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
            className={classNames("fadeable", {
              fade: this.state.sampleLoading || this.state.outputLoading
            })}
            lang={this.getRenderer().aceMode}
            theme="chrome"
            value={this.state.output}
            fontSize={(browser.mobile || browser.tablet) ? 13 : 14}
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
                  Copy {this.state.rendererName}
              </Button>
          </div>

          <Snackbar ref={(r) => { this.snackbar = r; }} />
      </main>
    );
  }
}

export default App;
