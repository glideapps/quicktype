import React, { Component } from 'react';
import AceEditor from 'react-ace';

export default class Editor extends Component {
  constructor(props) {
    super(props);
    this.state = {
      value: props.value
    };
    this.name = this.props.id + "-editor";
  }

  componentDidMount() {
    this.editor.setOption("displayIndentGuides", false);
    setTimeout(() => window.session = this.editor.getSession(), 3000);
  }

  resize = (height) => {
      this.editor.container.style.height = `${height}px`;
      this.editor.resize();
  }

  render() {
    return (
      <AceEditor
            ref={() => { this.editor = window.ace.edit(this.name); }}
            name={this.name}
            mode={this.props.lang}
            className={this.props.className}
            theme={this.props.theme}
            showGutter={this.props.showGutter}
            onChange={this.props.onChange}
            fontSize={this.props.fontSize || 14}
            highlightActiveLine={false}
            showPrintMargin={false}
            displayIndentGuides={false}
            editorProps={{$blockScrolling: true}}
            value={this.props.value}
            style={this.props.style}
          />
    );
  }
}