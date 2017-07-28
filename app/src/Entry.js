import React, { Component } from 'react';

export default class Entry extends Component {
   constructor(props) {
    super(props);
    this.state = {
      value: props.value
    };
    this.id = `entry-${props.name}`;
  }

  handleChange = (event) => {
    this.setState({value: event.target.value});
  }

  render() {
    return (
        <div className="mdc-textfield mdc-textfield--upgraded">
          <input type="text" id={this.id} className="mdc-textfield__input" onChange={this.handleChange} value={this.state.value} />
          <label className="mdc-textfield__label mdc-textfield__label--float-above" htmlFor={this.id}>
            {this.props.label}
          </label>
        </div>
    );
  }   
}