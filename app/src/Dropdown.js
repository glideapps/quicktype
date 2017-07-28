import React, { Component } from 'react';

import * as mdc from 'material-components-web/dist/material-components-web.js';
const { MDCSelect } = mdc.select; 

export default class Dropdown extends Component {
   constructor(props) {
    super(props);

    // When the component first loads, for some reason it always shows
    // the first entry as selected, no matter what I do, so we'll put that
    // one firt until I TODO fix this
    let entries = props.entries.sort((a, b) => {
      return (b === props.selected) - (a === props.selected);
    });

    this.state = {
      selected: props.selected,
      entries
    };
  }

  componentDidMount = () => {
    let select = new MDCSelect(this.ref);
    select.listen('MDCSelect:change', () => {
      this.ref.blur();
      this.setState({selected: select.value});
      this.props.onChange && this.props.onChange(select.value);
    });
  }

  render() {
    return (
        <div
          className="mdc-select"
          ref={(r) => { this.ref = r; }}
          role="listbox"
          tabIndex="0">
            <span className="mdc-select__selected-text">{this.state.selected}</span>
            <div className="mdc-simple-menu mdc-select__menu">
              <ul className="mdc-list mdc-simple-menu__items">
                {this.state.entries.map((label) => {
                  return (
                    <li
                      key={label}
                      className="mdc-list-item"
                      role="option" 
                      tabIndex="0"
                      aria-selected={this.state.selected === label}>
                      {label}
                    </li>
                  );
                })}
              </ul>
            </div>
        </div>
    );
  } 
}