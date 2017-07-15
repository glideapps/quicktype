import React, { Component } from 'react';
import { render } from 'react-dom';
import brace from 'brace';
import AceEditor from 'react-ace';
import Dropdown from 'react-dropdown';

import 'brace/mode/json';
import 'brace/mode/swift';
import 'brace/theme/github';
import 'brace/theme/cobalt';

import Main from "../../output/Main";

let samples = [
  "pokédex.json",
  "bitcoin-latest-block.json",
  "bitcoin-unconfirmed-transactions.json",
  "github-events.json",
  "us-average-temperatures.json",
];

class App extends Component {
  constructor(props) {
    super(props);
    this.state = {
      left: "",
      right: "",
      sample: localStorage["sample"] || samples[0]
    };
  }

  componentWillMount() {
    this.changeSample(this.state.sample);
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

  changeSample = (sample) => {
    this.setState({ sample });
    localStorage["sample"] = sample;
    fetch(`/sample/json/${sample}`)
      .then((data) => data.text())
      .then((data) => {
        this.sourceEdited(data);
      });
  }

  render() {
    return (
      <div>
        <Dropdown options={samples} value={this.state.sample} onChange={({value}) => this.changeSample(value)} />
        <div id="editors">
          <AceEditor
            name="left"
            mode="json"
            theme="github"
            fontSize="12pt"
            onChange={this.sourceEdited}
            editorProps={{$blockScrolling: true}}
            value={this.state.left}
          />
          <AceEditor
            name="right"
            mode="swift"
            theme="cobalt"
            fontSize="12pt"
            editorProps={{$blockScrolling: true}}
            value={this.state.right}
          />
        </div>
      </div>
    );
  }
}

export default App;
