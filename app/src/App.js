import React, { Component } from 'react';

import Sidebar from './Sidebar';
import Editor from './Editor';

import Main from "../../output/Main";
import Samples from "../../output/Samples";

import * as mdc from 'material-components-web';

import 'brace/mode/csharp';
import 'brace/theme/solarized_dark';

class App extends Component {
  constructor(props) {
    super(props);
    this.state = {
      left: "",
      right: "",
      renderer: Main.renderers[0]
    };
  }

  componentDidMount() {
     mdc.autoInit();
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

  sourceEdited = (newValue) => {
    let renderer = this.state.renderer;
    let result = this.sendPerformance("Main", "renderJsonString", () => Main.renderJsonString(renderer)(newValue));

    this.sendEvent("sourceEdited");

    if (result.constructor.name === "Left") {
      console.log(result.value0);
      this.setState({
        left: newValue
      });
    } else {
      this.setState({
        left: newValue,
        right: result.value0
      });
    }
  }

  changeRenderer = (renderer) => {
    this.setState({ renderer }, () => {
      this.sourceEdited(this.state.left);
    });
  }

  render() {
    return (
      <main className="mdc-theme--dark mdc-typography">
        <Sidebar
          renderer={this.state.renderer}
          onChangeRenderer={this.changeRenderer}
          source={this.state.left}
          onChangeSample={this.sourceEdited} />
        <Editor
          className="output"
          language="csharp"
          theme="solarized_dark"
          value={this.state.right}
          />
      </main>
    );
  }
}

export default App;
