import React, { Component } from 'react';
import { render } from 'react-dom';
import brace from 'brace';
import AceEditor from 'react-ace';

import 'brace/mode/json';
import 'brace/mode/swift';
import 'brace/theme/github';
import 'brace/theme/cobalt';

import Main from "../../output/Main";
 
let json = `{
  "name": "David",
  "age": 31,
  "addresses": [{"street": "222 Clayton St"}]
}`;

class App extends Component {
  constructor(props) {
    super(props);
    this.state = {left: json, right: Main.jsonToCSharp(json).value0};
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

    //console.log(window.e = Main.jsonToCSharpE(newValue));
  }

  render() {
    return (
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
    );
  }
}

export default App;
