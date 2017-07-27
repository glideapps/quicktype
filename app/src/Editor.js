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
            mode={this.props.lang}
            theme={this.props.theme}
            showGutter={this.props.showGutter}
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