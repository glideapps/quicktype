import React, { Component } from 'react';
import { render } from 'react-dom';
import brace from 'brace';
import AceEditor from 'react-ace';
import Dropdown from 'react-dropdown';

import 'brace/mode/json';
import 'brace/mode/csharp';
import 'brace/theme/github';
import 'brace/theme/cobalt';

import Main from "../../output/Main";

class Editor extends Component {
  constructor(props) {
    super(props);
    this.state = {
      value: props.value
    };
  }

  componentDidMount() {
    this.getEditor().setOption("displayIndentGuides", false);
  }

  getEditor = () => window.ace.edit(this.getName())
  getName = () => this.props.name + "-editor"

  render() {
    return (
      <div className={this.props.className}>
        <div className="titleBar">{this.props.language}</div>
        <div className="editor-container">
          <AceEditor
            name={this.getName()}
            mode={this.props.language}
            theme={this.props.theme}
            fontSize="10pt"
            showGutter={false}
            onChange={this.props.onChange}
            highlightActiveLine={false}
            showPrintMargin={false}
            displayIndentGuides={false}
            editorProps={{$blockScrolling: true}}
            value={this.props.value}
          />
        </div>
      </div>
    );
  }
}

class TopBar extends Component {
  samples = [
    "pokédex.json",
    "bitcoin-latest-block.json",
    "bitcoin-unconfirmed-transactions.json",
    "github-events.json",
    "us-average-temperatures.json",
  ];

  constructor(props) {
    super(props);
    this.state = {
      sample: localStorage["sample"] || this.samples[0]
    };
  }

  componentWillMount() {
    this.changeSample(this.state.sample);
  }

  changeSample = (sample) => {
    this.setState({sample});
    localStorage["sample"] = sample;
    fetch(`/sample/json/${sample}`)
      .then((data) => data.text())
      .then((data) => {
        this.props.onChangeSample(data);
      });
  }

  render() {
    return (
      <div className="topBar">
        <Dropdown
          options={this.samples}
          value={this.state.sample}
          onChange={({value}) => this.changeSample(value)} />
      </div>
    );
  }
}

class App extends Component {
  constructor(props) {
    super(props);
    this.state = {
      left: "",
      right: ""
    };
  }

  sourceEdited = (newValue) => {
    let result = Main.jsonToCSharp(newValue);

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

  render() {
    return (
      <div>
        <TopBar
          onChangeSample={this.sourceEdited} />
        <div id="editors">
          <Editor
            name="left"
            language="json"
            theme="github"
            onChange={this.sourceEdited}
            value={this.state.left}
          />
          <Editor
            name="right"
            language="csharp"
            theme="cobalt"
            value={this.state.right}
          />
        </div>
      </div>
    );
  }
}

export default App;
