import React, { Component } from 'react';
import AceEditor from 'react-ace';

export default class Editor extends Component {
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
  getName = () => this.props.className + "-editor"

  render() {
    return (
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
    );
  }
}